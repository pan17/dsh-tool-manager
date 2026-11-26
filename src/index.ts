import type {
  AgentDefaultModelLike,
  AgentLike,
  AgentPresetsLike,
  AgentPresetsSource,
  ContextLike,
  LlmModelReasoningInfoLike,
  LlmProviderInfoLike,
  LlmRuntimeLike,
  ToolRuntimeLike,
  ToolSchemaLike,
} from "./dsh.js";
import { asRecord, resolvePresets, schemasForPreset } from "./dsh.js";
import { CompositionWatch } from "./composition-watch.js";
import { ToolManagerConfigStore } from "./config.js";
import {
  groupPolicyIssues,
  matchesAnyPattern,
  normalizeGenerationSettings,
  policyFor,
  settingsForSave,
} from "./policy.js";
import { userNotices } from "./notices.js";
import { ToolPolicyRuntime } from "./runtime.js";
import { buildSnapshot, mergeSchemas } from "./snapshot.js";
import {
  DISCOVERY_TOOL_NAME,
  MCP_FIND_TOOL_NAME,
  PTC_TRANSPORT_NAME,
  TOOL_MANAGER_PROBE_SESSION_ID,
  type GenerationSettings,
  type ModelCatalogEntryView,
  type ModelCatalogFailureView,
  type ModelCatalogGroupView,
  type ModelCatalogView,
  type ModelChoice,
  type ModelReasoningView,
  type ToolManagerSettings,
  type ToolManagerSnapshot,
} from "./types.js";
import {
  generateAutoGroups,
  generateGroupSuggestion,
  normalizeCustomPrompt,
  normalizeGroupNames,
  resolveGenerationSelection,
  validateGenerationTimeout,
  selectSuggestionTools,
} from "./suggest.js";

export const name = "dsh-tool-manager";
export const inject = ["agentPresets", "agents", "tools", "systemPrompt"];

interface HttpRequest extends NodeJS.ReadableStream {
  method?: string;
}

interface HttpResponse {
  statusCode?: number;
  setHeader(name: string, value: string): void;
  end(chunk?: string): void;
}

interface WebServer {
  register(route: {
    kind: "exact" | "prefix";
    path: string;
    handler(req: HttpRequest, res: HttpResponse): void;
  }): () => void;
}

interface AgentHandleLike {
  agent: AgentLike;
  dispose(): Promise<void>;
}

interface AgentCreateOptionsLike {
  sessionId: string;
  meta?: { agentPreset?: string; origin?: "subagent" };
  setup?: (agentCtx: ContextLike, agent: AgentLike) => Promise<void> | void;
}

interface AgentResumeOptionsLike {
  resumeSessionId: string;
  setup?: (agentCtx: ContextLike, agent: AgentLike) => Promise<void> | void;
}

interface AgentRegistryLike {
  list(): AgentLike[];
  create(options: AgentCreateOptionsLike): Promise<AgentHandleLike>;
  resume(options: AgentResumeOptionsLike): Promise<AgentHandleLike>;
}

interface SessionPersistenceLike {
  stat(sessionId: string): Promise<unknown | undefined>;
}

/**
 * A single live probe prevents one persistent Session per request or Preset.
 * Preset switches are serialized because `recompose()` mutates this Agent's
 * scope parent before its scoped tool catalog is read.
 */
export class PresetSchemaProbe {
  private handle?: AgentHandleLike;
  private initialization?: Promise<AgentHandleLike | undefined>;
  private queue: Promise<void> = Promise.resolve();
  private disposed = false;
  /** The registry instance this probe's Agent is bound to. */
  private boundTo?: AgentPresetsLike;

  constructor(
    private readonly context: ContextLike,
    private readonly presets: AgentPresetsSource,
  ) {}

  inspect(presetId: string): Promise<ToolSchemaLike[]> {
    const operation = this.queue.then(
      () => this.inspectSerial(presetId),
      () => this.inspectSerial(presetId),
    );
    this.queue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private async inspectSerial(presetId: string): Promise<ToolSchemaLike[]> {
    if (this.disposed) return [];
    const presets = resolvePresets(this.presets);
    if (!presets) return [];
    await this.rebind(presets);
    const handle = await this.ensure(presets, presetId);
    if (!handle) return [];
    if (presets.composedPreset(handle.agent.ctx) !== presetId) {
      await presets.recompose(handle.agent.ctx, presetId);
      // Dynamic preset plugins reconcile Agent-scoped registrations from the
      // tools/change event emitted by recompose(). Some disposals complete on
      // the next event-loop turn, so reading immediately can leak the previous
      // Preset's scoped tools into this catalog result.
      await nextEventLoopTurn();
    }
    return handle.agent.ctx.get<ToolRuntimeLike>("tools")?.schemas(handle.agent) ?? [];
  }

  /**
   * Rebuild the probe Agent when DSH replaced the registry underneath it.
   *
   * The probe Session's scope parent names a generation of the retired
   * instance, which the new one does not know: `recompose()` there would leave
   * the Agent on a composition no live registry owns. Composing a fresh Agent
   * against the new instance is what re-binds it.
   */
  private async rebind(presets: AgentPresetsLike): Promise<void> {
    if (this.boundTo === presets) return;
    this.boundTo = presets;
    const handle = this.handle;
    this.handle = undefined;
    if (handle) await handle.dispose().catch(() => undefined);
  }

  private async ensure(
    presets: AgentPresetsLike,
    initialPresetId: string,
  ): Promise<AgentHandleLike | undefined> {
    if (this.handle) return this.handle;
    if (!this.initialization) {
      this.initialization = this.initialize(presets, initialPresetId).then(async (handle) => {
        if (!handle) return undefined;
        if (this.disposed) {
          await handle.dispose().catch(() => undefined);
          return undefined;
        }
        this.handle = handle;
        return handle;
      }).finally(() => {
        this.initialization = undefined;
      });
    }
    return this.initialization;
  }

  private async initialize(
    presets: AgentPresetsLike,
    initialPresetId: string,
  ): Promise<AgentHandleLike | undefined> {
    const agents = this.context.get<AgentRegistryLike>("agents");
    const persistence = this.context.get<SessionPersistenceLike>("sessionPersistence");
    if (!agents || !persistence) return undefined;

    const setup = async (agentCtx: ContextLike) => {
      await presets.mount(agentCtx, initialPresetId);
    };
    const existing = await persistence.stat(TOOL_MANAGER_PROBE_SESSION_ID);
    if (existing) {
      // A broken fixed probe is intentionally not replaced with a random id:
      // falling back to standing schemas is safer than growing Session storage.
      return agents.resume({
        resumeSessionId: TOOL_MANAGER_PROBE_SESSION_ID,
        setup,
      });
    }
    return agents.create({
      sessionId: TOOL_MANAGER_PROBE_SESSION_ID,
      meta: { agentPreset: initialPresetId, origin: "subagent" },
      setup,
    });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.queue.catch(() => undefined);
    const pending = this.initialization;
    const initialized = pending ? await pending.catch(() => undefined) : undefined;
    const handle = this.handle ?? initialized;
    this.handle = undefined;
    if (handle) await handle.dispose().catch(() => undefined);
  }
}

/**
 * The session-default preset's standing composition, composed before any other
 * preset this plugin mounts.
 *
 * `agentPresets` keeps ONE permanent standing composition per preset, and each
 * composition reconciles its own per-Agent tool registrations on every
 * `tools/change`. A blank Session is always composed from the deployment's
 * default preset and only then re-linked to the preset the mode picker names,
 * so that single switch dispatches one `tools/change` at which listeners run in
 * composition-mount order: the preset mounted FIRST disposes its per-Agent
 * registrations before the preset mounted SECOND claims the same tool names.
 *
 * Presets that install per-Agent tools — `modelSelectionSettings: true` on
 * `@deepseek-ai/dsh-tool-subagent` registers `subagent` and
 * `list_subagent_models` into the Agent's OWN scope layer — therefore lose
 * those tools on a default→preset switch whenever a non-default preset was
 * mounted first: a Session resumed in it, or this plugin's own catalog probe.
 * The tools stay missing for that Agent until it is rebuilt.
 *
 * Composing the default at plugin start pins the order to `[default, …]` for
 * the whole Host run, which is the order such a switch needs; every preset this
 * plugin mounts afterwards goes through {@link ensure} first. A failed attempt
 * is a warning, never a blocked catalog: the probe still answers from whatever
 * presets it can compose, and the next call retries.
 */
export class DefaultPresetMount {
  private attempt?: { presets: AgentPresetsLike; task: Promise<void> };
  private readyOn?: AgentPresetsLike;

  constructor(
    private readonly presets: AgentPresetsSource,
    private readonly warn: (message: string) => void,
  ) {}

  /**
   * Resolve once the default preset's standing composition exists, once its
   * composing attempt settled, or immediately when it already did.
   */
  async ensure(): Promise<void> {
    const presets = resolvePresets(this.presets);
    if (!presets) return;
    // Readiness is per registry instance. DSH replaces the instance when the
    // registry node reloads, and the new one owns none of the standing
    // compositions the retired one was measured on.
    if (this.readyOn === presets) return;
    if (this.attempt?.presets === presets) return this.attempt.task;
    const attempt = { presets, task: this.compose(presets) };
    this.attempt = attempt;
    try {
      await attempt.task;
    } finally {
      if (this.attempt === attempt) this.attempt = undefined;
    }
  }

  private async compose(presets: AgentPresetsLike): Promise<void> {
    try {
      const lease = await presets.acquireScope(undefined);
      await lease[Symbol.asyncDispose]();
      this.readyOn = presets;
    } catch (error) {
      this.warn(`tool-manager could not compose the default agent preset before other presets: ${errorMessage(error)}`);
    }
  }
}

/** Lazily probed catalogs plus the observer-visible schemas of one Preset. */
export interface PresetCatalog {
  /** Every schema known for one Preset, for the page's per-Preset catalog. */
  schemasFor(presetId: string): ToolSchemaLike[];
  /** Probe one Preset on demand so `schemasFor` can answer for it. */
  ensure(presetId: string): Promise<void>;
  /** Probe every Preset the roster supplies, so the page can list all of them. */
  ensureAll(): Promise<void>;
}

export interface PresetCatalogOptions {
  context: ContextLike;
  presets: AgentPresetsSource;
  probe: PresetSchemaProbe;
  defaultPreset: DefaultPresetMount;
  /** Schemas observed on live Agents of one Preset, without probing. */
  observed: (presetId: string) => readonly ToolSchemaLike[];
}

/**
 * Build the per-Preset catalog readers shared by the snapshot and save paths.
 *
 * A Preset with a live Agent answers from that Agent, so probing — and the
 * mount it needs — is skipped where the live view is authoritative. Every cold
 * Preset is probed only after the session default is composed (see
 * {@link DefaultPresetMount}), which is what keeps the mount order that mode
 * switching depends on.
 */
export function createPresetCatalog(options: PresetCatalogOptions): PresetCatalog {
  const { context, presets, probe, defaultPreset, observed } = options;
  // Tool registries emit their change edge before every Agent-scoped plugin has
  // necessarily finished reconciling. A settings-page request can therefore
  // sample a live Agent while one or more dynamic tools are in that transient
  // gap. Keep the union of completed live/probe observations so a later short
  // sample cannot make a real tool alternate between present and orphaned.
  const catalogedSchemas = new Map<string, ToolSchemaLike[]>();
  const pendingCatalogs = new Map<string, Promise<ToolSchemaLike[]>>();
  let instance: AgentPresetsLike | undefined;

  /**
   * Read the live registry, dropping what the retired instance taught us.
   *
   * A reloaded registry mounts new standing compositions: a schema proven on
   * the old instance describes a composition nothing owns any more, and the
   * Preset ids it was keyed by may not even exist in the new roster.
   */
  const readPresets = (): AgentPresetsLike | undefined => {
    const next = resolvePresets(presets);
    if (next === instance) return next;
    instance = next;
    catalogedSchemas.clear();
    pendingCatalogs.clear();
    return next;
  };

  const remember = (presetId: string, schemas: readonly ToolSchemaLike[]): ToolSchemaLike[] => {
    const merged = mergeSchemas(catalogedSchemas.get(presetId) ?? [], schemas);
    catalogedSchemas.set(presetId, merged);
    return merged;
  };

  const catalogSchemas = async (presetId: string): Promise<ToolSchemaLike[]> => {
    const current = readPresets();
    const live = current ? livePresetSchemas(context, current, presetId) : undefined;
    if (live) return remember(presetId, live);
    await defaultPreset.ensure();
    let pending = pendingCatalogs.get(presetId);
    if (!pending) {
      pending = probe.inspect(presetId).then((schemas) => remember(presetId, schemas))
        .finally(() => pendingCatalogs.delete(presetId));
      pendingCatalogs.set(presetId, pending);
    }
    return pending;
  };

  return {
    schemasFor: (presetId) => mergeSchemas(catalogedSchemas.get(presetId) ?? [], observed(presetId)),
    ensure: async (presetId) => {
      await catalogSchemas(presetId);
    },
    ensureAll: async () => {
      const current = readPresets();
      if (!current) return;
      const inventory = await current.compositionInventory();
      await Promise.all(inventory.filter((item) => !item.broken).map((item) => catalogSchemas(item.id)));
    },
  };
}

export function apply(ctx: unknown): void {
  const context = ctx as ContextLike;
  /**
   * Read the services on every use, never at load.
   *
   * DSH reloads a plugin node by re-applying it on the same Fiber, which
   * constructs a new service instance: the preset registry publishes a fresh
   * `definitions` map that every preset re-registers into, and the retired
   * instance keeps the empty map its unregister disposers left. A reference
   * captured here would answer "no Presets" for the rest of the Host run, and
   * `composedPreset()` would return `undefined` for every Agent — silently
   * dropping that Agent's policy — until DSH is restarted.
   */
  const presetsSource = (): AgentPresetsLike | undefined =>
    context.get<AgentPresetsLike>("agentPresets");
  const toolsSource = (): ToolRuntimeLike | undefined => context.get<ToolRuntimeLike>("tools");
  if (!presetsSource() || !toolsSource()) {
    throw new Error("dsh-tool-manager requires agentPresets, agents, and tools");
  }

  /** The services one request reads, or `undefined` while DSH swaps them. */
  const services = (): { presets: AgentPresetsLike; tools: ToolRuntimeLike } | undefined => {
    const presets = presetsSource();
    const tools = toolsSource();
    return presets && tools ? { presets, tools } : undefined;
  };

  const config = new ToolManagerConfigStore();
  const notices = userNotices();
  const runtime = new ToolPolicyRuntime(
    context,
    presetsSource,
    config.get(),
    (notice) => notices.add(notice),
  );
  runtime.start();
  const probe = new PresetSchemaProbe(context, presetsSource);
  const defaultPreset = new DefaultPresetMount(presetsSource, (message) => warn(context, message));
  // Compose the default preset now, not on the first page load: the composition
  // mounted first owns the reconciliation order every later mode switch needs,
  // and a Session resumed in another preset would otherwise take that place.
  void defaultPreset.ensure();
  const catalog = createPresetCatalog({
    context,
    presets: presetsSource,
    probe,
    defaultPreset,
    observed: (presetId) => runtime.observedSchemasFor(presetId),
  });
  const ensureAllPresetSchemas = (): Promise<void> => catalog.ensureAll();

  // Mount order is a best-effort prediction of DSH's per-Agent reconciliation
  // race; this watch is the part that does not depend on winning it. It
  // re-calibrates any Session whose mode changed, whatever plugin lost the race
  // for which tool names (see composition-watch.ts).
  const compositionWatch = new CompositionWatch({
    presets: presetsSource,
    agents: () => context.get<AgentRegistryLike>("agents")?.list() ?? [],
    tools: toolsSource,
    probe: (presetId) => probe.inspect(presetId),
    explainedLoss: (presetId, toolName) => {
      // This plugin's own tools, plus every name its policy hides on purpose:
      // a group that closed or a tool the user disabled is not a lost
      // registration, and reporting it would be a false alarm.
      if (toolName === DISCOVERY_TOOL_NAME || toolName === PTC_TRANSPORT_NAME) return true;
      if (toolName === MCP_FIND_TOOL_NAME) return true;
      const policy = policyFor(config.get(), presetId);
      if (policy.disabled.includes(toolName)) return true;
      return policy.groups.some((group) => matchesAnyPattern(toolName, group.patterns));
    },
    excludeAgentId: TOOL_MANAGER_PROBE_SESSION_ID,
    onReloaded: (agent, presetId) => {
      // Re-attaching happens on the Session's next step; this only makes the
      // reader aware early, and is dropped again once a repair succeeds.
      notices.add({
        kind: "reloading",
        ...(agent.id === undefined ? {} : { sessionId: agent.id }),
        presetId,
        message:
          `agent preset 注册表刚被重载：会话「${agent.id ?? "未知"}」的 preset ${presetId} 绑定失效，` +
          "插件会在该会话下一次对话前自动重新挂载（不需要重启）。" +
          "如果下一步工具仍然缺失，这里会出现一条需要重启 DSH 的提示。",
      });
    },
    warn: (message) => warn(context, message),
    info: (message) => info(context, message),
  });
  compositionWatch.start(context);

  context.inject?.(["webServer"], (webCtx) => {
    const webServer = webCtx.get<WebServer>("webServer");
    if (!webServer) return;

    /**
     * Every route this instance owns.
     *
     * `register()` refuses a duplicate path and hands back the disposer that
     * lifts this one. Dropping them leaves a retired instance's handlers in the
     * host's route table: the reloaded plugin then cannot register its own and
     * the page keeps talking to a runtime nobody drives any more. Cordis only
     * collects what the inject callback returns, so hand the disposers back.
     */
    const routes: Array<() => void> = [];
    const route = (options: Parameters<WebServer["register"]>[0]): void => {
      try {
        routes.push(webServer.register(options));
      } catch (error) {
        // A refused route must not leave the earlier ones half-registered: the
        // callback is about to fail, and nothing would ever dispose them.
        for (const dispose of routes.splice(0)) dispose();
        throw error;
      }
    };

    /** Build a snapshot from whatever services are live at this moment. */
    const buildCurrentSnapshot = async (): Promise<ToolManagerSnapshot> => {
      const live = services();
      if (!live) throw new Error(SERVICE_RELOADING);
      const snapshot = await buildSnapshot(
        live.presets,
        live.tools,
        config.get(),
        config.revision,
        config.path,
        catalog.schemasFor,
      );
      return { ...snapshot, ...generationView() };
    };

    /**
     * The generation-model block the page renders beside the tool catalog.
     *
     * It belongs to no Preset, so it is projected here instead of inside
     * `buildSnapshot`: the snapshot builder is handed no default-model service,
     * and the page needs the default selection named to explain "跟随默认模型".
     */
    const generationView = (): Pick<ToolManagerSnapshot, "generation" | "defaultSelection"> => {
      const stored = config.get().generation;
      let defaultSelection: ModelChoice | undefined;
      try {
        const selection = context.get<AgentDefaultModelLike>("agentDefaultModel")?.currentSelection();
        if (selection?.provider && selection.model) {
          defaultSelection = {
            provider: selection.provider,
            model: selection.model,
            ...(selection.reasoningEffort ? { reasoningEffort: selection.reasoningEffort } : {}),
          };
        }
      } catch {
        // A Host without a default-model service simply has nothing to name.
        defaultSelection = undefined;
      }
      return {
        ...(stored ? { generation: { ...stored } } : {}),
        ...(defaultSelection ? { defaultSelection } : {}),
      };
    };

    /**
     * The generation model one request runs.
     *
     * The page sends its whole draft, so a model picked but not yet saved takes
     * effect immediately; a body without the key (an older page) keeps whatever
     * the config already stores instead of silently clearing it.
     */
    const generationChoiceOf = (body: Record<string, unknown> | undefined): GenerationSettings | undefined => {
      if (body && Object.prototype.hasOwnProperty.call(body, "generation")) {
        return normalizeGenerationSettings(body.generation);
      }
      return config.get().generation;
    };

    /**
     * The registry instance whose empty roster this plugin already waited out.
     *
     * A deployment that genuinely declares no Preset must not pay the wait on
     * every page load, while every newly published instance gets one wait.
     */
    let rosterSettled: AgentPresetsLike | undefined;

    route({
      kind: "exact",
      path: "/tool-manager/api/snapshot",
      handler: (req, res) => {
        if (String(req.method ?? "GET").toUpperCase() !== "GET") {
          sendJson(res, 405, { ok: false, message: "method not allowed" });
          return;
        }
        if (!services()) {
          sendJson(res, 503, { ok: false, message: SERVICE_RELOADING });
          return;
        }
        void (async () => {
          let snapshot = await ensureAllPresetSchemas().then(buildCurrentSnapshot);
          // The reload window: DSH publishes the new registry before every
          // preset node has re-registered into it, and this plugin's own node
          // may come back first. A page opened in that gap would otherwise show
          // "no Agent Preset" until the user reloaded it by hand.
          const instance = services()?.presets;
          if (snapshot.presets.length === 0 && instance !== undefined && instance !== rosterSettled) {
            for (let waited = 0; waited < ROSTER_SETTLE_MS; waited += ROSTER_POLL_MS) {
              await delay(ROSTER_POLL_MS);
              if (!services()) break;
              await ensureAllPresetSchemas();
              snapshot = await buildCurrentSnapshot();
              if (snapshot.presets.length > 0) break;
            }
            rosterSettled = services()?.presets ?? rosterSettled;
          }
          return snapshot;
        })().then(
          (snapshot) => sendJson(res, 200, snapshot),
          (error) => sendJson(res, 500, { ok: false, message: errorMessage(error) }),
        );
      },
    });

    route({
      kind: "exact",
      path: "/tool-manager/api/models",
      handler: (req, res) => {
        if (String(req.method ?? "GET").toUpperCase() !== "GET") {
          sendJson(res, 405, { ok: false, message: "method not allowed" });
          return;
        }
        const llm = context.get<LlmRuntimeLike>("llm");
        if (!llm || typeof llm.listProviders !== "function" || typeof llm.listModels !== "function") {
          sendJson(res, 503, { ok: false, message: "当前 DSH 不提供模型目录，无法列出可选模型。" });
          return;
        }
        void readModelCatalog(llm).then(
          (catalog) => sendJson(res, 200, catalog),
          (error) => sendJson(res, 500, { ok: false, message: errorMessage(error) }),
        );
      },
    });

    route({
      kind: "exact",
      path: "/tool-manager/api/suggest-group",
      handler: (req, res) => {
        if (String(req.method ?? "POST").toUpperCase() !== "POST") {
          sendJson(res, 405, { ok: false, message: "method not allowed" });
          return;
        }
        void (async () => {
          const live = services();
          if (!live) throw new Error(SERVICE_RELOADING);
          const llm = context.get<LlmRuntimeLike>("llm");
          const defaultModel = context.get<AgentDefaultModelLike>("agentDefaultModel");
          if (!llm || !defaultModel) {
            throw new Error("当前 DSH 没有可用的默认模型服务，无法自动生成");
          }
          const body = asRecord(await readJsonBody(req));
          const presetId = typeof body?.presetId === "string" ? body.presetId.trim() : "";
          if (!presetId) throw new Error("presetId is required");
          const inventory = await live.presets.compositionInventory();
          if (!inventory.some((item) => item.id === presetId)) throw new Error(`unknown preset ${JSON.stringify(presetId)}`);
          await defaultPreset.ensure();
          const standing = await schemasForPreset(live.presets, live.tools, presetId);
          const schemas = mergeSchemas(standing, await catalog.schemasFor(presetId))
            .filter((schema) => (
              schema.name !== DISCOVERY_TOOL_NAME
              && schema.name !== PTC_TRANSPORT_NAME
              && schema.name !== MCP_FIND_TOOL_NAME
            ));
          const selected = selectSuggestionTools(schemas, body?.toolNames);
          const otherGroupNames = normalizeGroupNames(body?.otherGroupNames);
          const timeoutMs = body?.timeoutMs === undefined
            ? undefined
            : validateGenerationTimeout(body.timeoutMs);
          const prompt = normalizeCustomPrompt(body?.prompt);
          if (body?.prompt !== undefined && prompt === undefined) throw new Error("提示词不能为空");
          const resolved = await resolveGenerationSelection(llm, defaultModel, generationChoiceOf(body));
          const suggestion = await generateGroupSuggestion(llm, defaultModel, {
            tools: selected,
            otherGroupNames,
            prompt,
            selection: resolved.selection,
          }, timeoutMs);
          return resolved.notice ? { ...suggestion, modelNotice: resolved.notice } : suggestion;
        })().then(
          (suggestion) => sendJson(res, 200, suggestion),
          (error) => sendJson(res, 400, { ok: false, message: errorMessage(error) }),
        );
      },
    });

    route({
      kind: "exact",
      path: "/tool-manager/api/auto-group",
      handler: (req, res) => {
        if (String(req.method ?? "POST").toUpperCase() !== "POST") {
          sendJson(res, 405, { ok: false, message: "method not allowed" });
          return;
        }
        void (async () => {
          const live = services();
          if (!live) throw new Error(SERVICE_RELOADING);
          const llm = context.get<LlmRuntimeLike>("llm");
          const defaultModel = context.get<AgentDefaultModelLike>("agentDefaultModel");
          if (!llm || !defaultModel) {
            throw new Error("当前 DSH 没有可用的默认模型服务，无法自动分组");
          }
          const body = asRecord(await readJsonBody(req));
          const presetId = typeof body?.presetId === "string" ? body.presetId.trim() : "";
          if (!presetId) throw new Error("presetId is required");
          const inventory = await live.presets.compositionInventory();
          if (!inventory.some((item) => item.id === presetId)) throw new Error(`unknown preset ${JSON.stringify(presetId)}`);
          await defaultPreset.ensure();
          const standing = await schemasForPreset(live.presets, live.tools, presetId);
          const schemas = mergeSchemas(standing, await catalog.schemasFor(presetId))
            .filter((schema) => (
              schema.name !== DISCOVERY_TOOL_NAME
              && schema.name !== PTC_TRANSPORT_NAME
              && schema.name !== MCP_FIND_TOOL_NAME
            ));
          const selected = selectSuggestionTools(schemas, body?.toolNames);
          const otherGroupNames = normalizeGroupNames(body?.otherGroupNames);
          const timeoutMs = body?.timeoutMs === undefined
            ? undefined
            : validateGenerationTimeout(body.timeoutMs);
          const prompt = normalizeCustomPrompt(body?.prompt);
          if (body?.prompt !== undefined && prompt === undefined) throw new Error("提示词不能为空");
          const resolved = await resolveGenerationSelection(llm, defaultModel, generationChoiceOf(body));
          const result = await generateAutoGroups(llm, defaultModel, {
            tools: selected,
            otherGroupNames,
            prompt,
            selection: resolved.selection,
          }, timeoutMs);
          return resolved.notice ? { ...result, modelNotice: resolved.notice } : result;
        })().then(
          (result) => sendJson(res, 200, result),
          (error) => sendJson(res, 400, { ok: false, message: errorMessage(error) }),
        );
      },
    });

    route({
      kind: "exact",
      path: "/tool-manager/api/repair",
      handler: (_req, res) => {
        sendJson(res, 200, { ...runtime.repairDiagnostics(), presets: presetsSource() !== undefined });
      },
    });

    route({
      kind: "exact",
      path: "/tool-manager/api/notices",
      handler: (req, res) => {
        const method = String(req.method ?? "GET").toUpperCase();
        if (method === "GET") {
          sendJson(res, 200, { notices: notices.list() });
          return;
        }
        if (method !== "POST") {
          sendJson(res, 405, { ok: false, message: "method not allowed" });
          return;
        }
        void (async () => {
          const body = asRecord(await readJsonBody(req));
          const ids = Array.isArray(body?.ids)
            ? body.ids.filter((id): id is string => typeof id === "string")
            : [];
          notices.ack(ids);
          sendJson(res, 200, { notices: notices.list() });
        })().catch((error: unknown) => sendJson(res, 400, { ok: false, message: errorMessage(error) }));
      },
    });

    route({
      kind: "exact",
      path: "/tool-manager/api/save",
      handler: (req, res) => {
        if (String(req.method ?? "POST").toUpperCase() !== "POST") {
          sendJson(res, 405, { ok: false, message: "method not allowed" });
          return;
        }
        void (async () => {
          const live = services();
          if (!live) throw new Error(SERVICE_RELOADING);
          const body = asRecord(await readJsonBody(req));
          const expectedRevision = body && typeof body.expectedRevision === "number"
            ? body.expectedRevision
            : undefined;
          // The page's own `generation` key decides that setting: an explicit
          // null follows the default model again, while a page loaded before the
          // setting existed omits it and keeps the stored choice (see policy.ts).
          const next = settingsForSave(body?.settings, config.get());
          // Save validation must read the same catalog the page rendered. A
          // standing-only read misses every tool a plugin registers into each
          // Agent's own scope — `dsh-schedule` attaches `schedule_*` to every
          // root Agent, `dsh-tool-subagent` injects `subagent` there — so a
          // group built from those tools is rejected as empty although the page
          // lists them and the runtime opens them normally.
          await assertNoEmptyGroups(
            live.presets,
            live.tools,
            next,
            () => defaultPreset.ensure(),
            (presetId) => visiblePresetToolNames(live.presets, live.tools, catalog, presetId),
          );
          await config.replace(next, expectedRevision);
          runtime.update(config.get());
          // `buildSnapshot` mounts every inspectable preset, so the default must
          // already be composed before it runs (see DefaultPresetMount).
          await defaultPreset.ensure();
          return buildCurrentSnapshot();
        })().then(
          (snapshot) => sendJson(res, 200, snapshot),
          (error) => sendJson(res, 400, { ok: false, message: errorMessage(error) }),
        );
      },
    });

    route({
      kind: "exact",
      path: "/tool-manager/api/generation",
      handler: (req, res) => {
        if (String(req.method ?? "POST").toUpperCase() !== "POST") {
          sendJson(res, 405, { ok: false, message: "method not allowed" });
          return;
        }
        void (async () => {
          const live = services();
          if (!live) throw new Error(SERVICE_RELOADING);
          const body = asRecord(await readJsonBody(req));
          // Written on change, so it carries no expectedRevision: it never touches
          // the Preset policies a page may be drafting, and the config store
          // serializes it with the next 「保存」. The runtime only reads policies,
          // so it needs no update here.
          const generation = normalizeGenerationSettings(body?.generation);
          const settings = await config.updateGeneration(generation);
          return { revision: config.revision, generation: settings.generation };
        })().then(
          (result) => sendJson(res, 200, result),
          (error) => sendJson(res, 400, { ok: false, message: errorMessage(error) }),
        );
      },
    });

    return () => {
      for (const dispose of routes.splice(0)) {
        try {
          dispose();
        } catch {
          // A host that already dropped the table must not block the unload.
        }
      }
    };
  });

  context.effect?.(() => async () => {
    compositionWatch.dispose();
    await probe.dispose();
    await runtime.dispose();
  }, "dsh-tool-manager runtime");
}

function livePresetSchemas(
  context: ContextLike,
  presets: AgentPresetsLike,
  presetId: string,
): ToolSchemaLike[] | undefined {
  const agents = context.get<AgentRegistryLike>("agents");
  const existing = agents?.list().find((agent) => presets.composedPreset(agent.ctx) === presetId);
  if (!existing) return undefined;
  return existing.ctx.get<ToolRuntimeLike>("tools")?.schemas(existing) ?? [];
}

function warn(context: ContextLike, message: string): void {
  context.get<{ warn?(format: unknown, ...rest: unknown[]): void }>("logger")?.warn?.(message);
}

/** Informational sink that still surfaces when the Host logger has no info level. */
function info(context: ContextLike, message: string): void {
  const logger = context.get<{
    info?(format: unknown, ...rest: unknown[]): void;
    warn?(format: unknown, ...rest: unknown[]): void;
  }>("logger");
  (logger?.info ?? logger?.warn)?.(message);
}

/**
 * Every tool name the page can show for one Preset: the standing composition
 * unioned with the Agent-scoped registrations the probe and live Agents
 * observed.
 *
 * Returns `undefined` when the standing composition cannot be read at all, so
 * the save path keeps its historical "an uninspectable Preset is not validated"
 * behaviour instead of reporting every group as empty.
 */
export async function visiblePresetToolNames(
  presets: AgentPresetsLike,
  tools: ToolRuntimeLike,
  catalog: Pick<PresetCatalog, "schemasFor" | "ensure">,
  presetId: string,
): Promise<string[] | undefined> {
  const standing = await schemasForPreset(presets, tools, presetId).catch(() => undefined);
  if (!standing) return undefined;
  await catalog.ensure(presetId).catch(() => undefined);
  const names = new Set(standing.map((schema) => schema.name));
  for (const schema of catalog.schemasFor(presetId)) names.add(schema.name);
  return [...names];
}

export async function assertNoEmptyGroups(
  presets: AgentPresetsLike,
  tools: ToolRuntimeLike,
  settings: ToolManagerSettings,
  /** Composes the session default before this call mounts any other preset. */
  composeDefaultFirst?: () => Promise<void>,
  /**
   * Reads the tool names one Preset can actually expose. Callers that have a
   * merged catalog must pass it: a standing-only read misses the tools plugins
   * register into each Agent's own scope, which the page lists and the runtime
   * happily opens. `undefined` skips that Preset.
   */
  toolNamesFor?: (presetId: string) => Promise<string[] | undefined> | string[] | undefined,
): Promise<void> {
  const inventory = await presets.compositionInventory();
  const inspectable = new Map(inventory.map((item) => [item.id, item]));
  for (const [presetId, policy] of Object.entries(settings.presets)) {
    // Groups stay in the config for mcp-mode presets but never drive loading,
    // so an empty (or stale) group must not block saving that mode.
    if (policy.mode === "mcp") continue;
    if (policy.groups.length === 0) continue;
    const composition = inspectable.get(presetId);
    if (!composition || composition.broken) continue;
    let names: string[] | undefined;
    try {
      await composeDefaultFirst?.();
      names = toolNamesFor
        ? await toolNamesFor(presetId)
        : (await schemasForPreset(presets, tools, presetId)).map((schema) => schema.name);
    } catch {
      continue;
    }
    if (names === undefined) continue;
    const issues = groupPolicyIssues(policyFor(settings, presetId), names);
    if (issues.disabledMembers.length > 0) {
      const issue = issues.disabledMembers[0]!;
      throw new Error(
        `Preset ${JSON.stringify(presetId)} has disabled tool ${JSON.stringify(issue.tool)} in group ${JSON.stringify(issue.groups[0])}. Disabled tools cannot belong to on-demand groups.`,
      );
    }
    if (issues.duplicateMembers.length > 0) {
      const issue = issues.duplicateMembers[0]!;
      throw new Error(
        `Preset ${JSON.stringify(presetId)} assigns tool ${JSON.stringify(issue.tool)} to multiple groups: ${issue.groups.map((name) => JSON.stringify(name)).join(", ")}. Each tool may belong to only one group.`,
      );
    }
    if (issues.emptyGroups.length > 0) {
      throw new Error(
        `Preset ${JSON.stringify(presetId)} has empty tool groups: ${issues.emptyGroups.map((name) => JSON.stringify(name)).join(", ")}. Each group must contain at least one available tool.`,
      );
    }
  }
}



/**
 * The models the settings page may offer for AI generation.
 *
 * Same projection DSH's own model selector uses: every registered route, the
 * models it advertises, and each model's own reasoning efforts. A route whose
 * catalog cannot be read is reported as a failure instead of being dropped, and
 * a model whose exact metadata cannot be resolved keeps its name without
 * efforts — a provider outage must not empty the whole picker.
 * @param llm - the live `llm` service.
 * @returns provider groups in registration order, plus per-provider failures.
 */
export async function readModelCatalog(llm: LlmRuntimeLike): Promise<ModelCatalogView> {
  const groups: ModelCatalogGroupView[] = [];
  const failures: ModelCatalogFailureView[] = [];
  let providers: readonly LlmProviderInfoLike[] = [];
  if (typeof llm.listProviders === "function") {
    try {
      providers = llm.listProviders();
    } catch {
      providers = [];
    }
  }
  for (const provider of providers) {
    const name = provider.name || provider.id;
    try {
      const models = await llm.listModels?.(provider.id) ?? [];
      const entries: ModelCatalogEntryView[] = await Promise.all(models.map(async (model) => {
        const reasoning = await reasoningView(llm, provider.id, model.id);
        return {
          id: model.id,
          name: model.name || model.id,
          ...(model.description ? { description: model.description } : {}),
          ...(reasoning ? { reasoning } : {}),
        };
      }));
      if (entries.length > 0) groups.push({ id: provider.id, name, models: entries });
    } catch (error) {
      failures.push({ id: provider.id, name, message: errorMessage(error) });
    }
  }
  return { groups, failures };
}

/** The efforts one exact route accepts, or `undefined` when it declares none. */
async function reasoningView(
  llm: LlmRuntimeLike,
  provider: string,
  model: string,
): Promise<ModelReasoningView | undefined> {
  if (typeof llm.resolveModelInfo !== "function") return undefined;
  let reasoning: LlmModelReasoningInfoLike | undefined;
  try {
    reasoning = (await llm.resolveModelInfo(provider, model))?.reasoning;
  } catch {
    return undefined;
  }
  if (!reasoning || reasoning.efforts.length === 0) return undefined;
  return {
    efforts: reasoning.efforts.map((effort) => ({
      id: effort.id,
      name: effort.name || effort.id,
      ...(effort.description ? { description: effort.description } : {}),
    })),
    ...(reasoning.defaultEffort ? { defaultEffort: reasoning.defaultEffort } : {}),
  };
}

function nextEventLoopTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** Answer while DSH holds no instance of a service this plugin reads. */
const SERVICE_RELOADING = "the agent preset registry is reloading; retry in a moment";

/**
 * How long the snapshot endpoint waits for a reloaded registry to finish
 * re-registering its presets before it answers with an empty roster.
 *
 * A Preset node re-registers in its own Fiber, so the roster is filled in a
 * different order than the service instance is published. Presets mount whole
 * plugin trees, so the window is longer than one event-loop turn.
 */
const ROSTER_SETTLE_MS = 1500;
const ROSTER_POLL_MS = 100;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJsonBody(req: HttpRequest): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk as Uint8Array);
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw.trim() ? JSON.parse(raw) : {};
}

function sendJson(res: HttpResponse, status: number, value: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(value));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export { TOOL_MANAGER_PROBE_SESSION_ID } from "./types.js";
export { CompositionWatch, isBlankSession } from "./composition-watch.js";
export type { CompositionWatchOptions } from "./composition-watch.js";
export type * from "./types.js";
