import type {
  AgentDefaultModelLike,
  AgentLike,
  AgentPresetsLike,
  ContextLike,
  LlmRuntimeLike,
  ToolRuntimeLike,
  ToolSchemaLike,
} from "./dsh.js";
import { asRecord } from "./dsh.js";
import { CompositionWatch } from "./composition-watch.js";
import { ToolManagerConfigStore } from "./config.js";
import { groupPolicyIssues, matchesAnyPattern, normalizeSettings, policyFor } from "./policy.js";
import { ToolPolicyRuntime } from "./runtime.js";
import { buildSnapshot, mergeSchemas } from "./snapshot.js";
import {
  DISCOVERY_TOOL_NAME,
  PTC_TRANSPORT_NAME,
  TOOL_MANAGER_PROBE_SESSION_ID,
} from "./types.js";
import {
  generateAutoGroups,
  generateGroupSuggestion,
  normalizeCustomPrompt,
  normalizeGroupNames,
  validateGenerationTimeout,
  selectSuggestionTools,
} from "./suggest.js";

export const name = "dsh-tool-manager";
export const inject = ["agentPresets", "agents", "tools"];

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
  }): unknown;
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

  constructor(
    private readonly context: ContextLike,
    private readonly presets: AgentPresetsLike,
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
    const handle = await this.ensure(presetId);
    if (!handle) return [];
    if (this.presets.composedPreset(handle.agent.ctx) !== presetId) {
      await this.presets.recompose(handle.agent.ctx, presetId);
      // Dynamic preset plugins reconcile Agent-scoped registrations from the
      // tools/change event emitted by recompose(). Some disposals complete on
      // the next event-loop turn, so reading immediately can leak the previous
      // Preset's scoped tools into this catalog result.
      await nextEventLoopTurn();
    }
    return handle.agent.ctx.get<ToolRuntimeLike>("tools")?.schemas(handle.agent) ?? [];
  }

  private async ensure(initialPresetId: string): Promise<AgentHandleLike | undefined> {
    if (this.handle) return this.handle;
    if (!this.initialization) {
      this.initialization = this.initialize(initialPresetId).then(async (handle) => {
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

  private async initialize(initialPresetId: string): Promise<AgentHandleLike | undefined> {
    const agents = this.context.get<AgentRegistryLike>("agents");
    const persistence = this.context.get<SessionPersistenceLike>("sessionPersistence");
    if (!agents || !persistence) return undefined;

    const setup = async (agentCtx: ContextLike) => {
      await this.presets.mount(agentCtx, initialPresetId);
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
  private attempt?: Promise<void>;
  private ready = false;

  constructor(
    private readonly presets: AgentPresetsLike,
    private readonly warn: (message: string) => void,
  ) {}

  /**
   * Resolve once the default preset's standing composition exists, once its
   * composing attempt settled, or immediately when it already did.
   */
  async ensure(): Promise<void> {
    if (this.ready) return;
    this.attempt ??= this.compose();
    await this.attempt;
  }

  private async compose(): Promise<void> {
    try {
      await this.presets.standingKeyFor(undefined);
      this.ready = true;
    } catch (error) {
      this.warn(`tool-manager could not compose the default agent preset before other presets: ${errorMessage(error)}`);
    } finally {
      this.attempt = undefined;
    }
  }
}

/** Lazily probed catalogs plus the observer-visible schemas of one Preset. */
export interface PresetCatalog {
  /** Every schema known for one Preset, for the page's per-Preset catalog. */
  schemasFor(presetId: string): ToolSchemaLike[];
  /** Probe every Preset the roster supplies, so the page can list all of them. */
  ensureAll(): Promise<void>;
}

export interface PresetCatalogOptions {
  context: ContextLike;
  presets: AgentPresetsLike;
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

  const remember = (presetId: string, schemas: readonly ToolSchemaLike[]): ToolSchemaLike[] => {
    const merged = mergeSchemas(catalogedSchemas.get(presetId) ?? [], schemas);
    catalogedSchemas.set(presetId, merged);
    return merged;
  };

  const catalogSchemas = async (presetId: string): Promise<ToolSchemaLike[]> => {
    const live = livePresetSchemas(context, presets, presetId);
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
    ensureAll: async () => {
      const inventory = await presets.compositionInventory();
      await Promise.all(inventory.filter((item) => !item.broken).map((item) => catalogSchemas(item.id)));
    },
  };
}

export function apply(ctx: unknown): void {
  const context = ctx as ContextLike;
  const presets = context.get<AgentPresetsLike>("agentPresets");
  const tools = context.get<ToolRuntimeLike>("tools");
  if (!presets || !tools) {
    throw new Error("dsh-tool-manager requires agentPresets, agents, and tools");
  }

  const config = new ToolManagerConfigStore();
  const runtime = new ToolPolicyRuntime(context, presets, config.get());
  runtime.start();
  const probe = new PresetSchemaProbe(context, presets);
  const defaultPreset = new DefaultPresetMount(presets, (message) => warn(context, message));
  // Compose the default preset now, not on the first page load: the composition
  // mounted first owns the reconciliation order every later mode switch needs,
  // and a Session resumed in another preset would otherwise take that place.
  void defaultPreset.ensure();
  const catalog = createPresetCatalog({
    context,
    presets,
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
    presets,
    agents: () => context.get<AgentRegistryLike>("agents")?.list() ?? [],
    tools: () => tools,
    probe: (presetId) => probe.inspect(presetId),
    explainedLoss: (presetId, toolName) => {
      // This plugin's own tools, plus every name its policy hides on purpose:
      // a group that closed or a tool the user disabled is not a lost
      // registration, and reporting it would be a false alarm.
      if (toolName === DISCOVERY_TOOL_NAME || toolName === PTC_TRANSPORT_NAME) return true;
      const policy = policyFor(config.get(), presetId);
      if (policy.disabled.includes(toolName)) return true;
      return policy.groups.some((group) => matchesAnyPattern(toolName, group.patterns));
    },
    excludeAgentId: TOOL_MANAGER_PROBE_SESSION_ID,
    warn: (message) => warn(context, message),
    info: (message) => info(context, message),
  });
  compositionWatch.start(context);

  context.inject?.(["webServer"], (webCtx) => {
    const webServer = webCtx.get<WebServer>("webServer");
    if (!webServer) return;

    webServer.register({
      kind: "exact",
      path: "/tool-manager/api/snapshot",
      handler: (req, res) => {
        if (String(req.method ?? "GET").toUpperCase() !== "GET") {
          sendJson(res, 405, { ok: false, message: "method not allowed" });
          return;
        }
        void ensureAllPresetSchemas().then(
          () => buildSnapshot(presets, tools, config.get(), config.revision, config.path, catalog.schemasFor),
        ).then(
          (snapshot) => sendJson(res, 200, snapshot),
          (error) => sendJson(res, 500, { ok: false, message: errorMessage(error) }),
        );
      },
    });

    webServer.register({
      kind: "exact",
      path: "/tool-manager/api/suggest-group",
      handler: (req, res) => {
        if (String(req.method ?? "POST").toUpperCase() !== "POST") {
          sendJson(res, 405, { ok: false, message: "method not allowed" });
          return;
        }
        void (async () => {
          const llm = context.get<LlmRuntimeLike>("llm");
          const defaultModel = context.get<AgentDefaultModelLike>("agentDefaultModel");
          if (!llm || !defaultModel) {
            throw new Error("当前 DSH 没有可用的默认模型服务，无法自动生成");
          }
          const body = asRecord(await readJsonBody(req));
          const presetId = typeof body?.presetId === "string" ? body.presetId.trim() : "";
          if (!presetId) throw new Error("presetId is required");
          const inventory = await presets.compositionInventory();
          if (!inventory.some((item) => item.id === presetId)) throw new Error(`unknown preset ${JSON.stringify(presetId)}`);
          await defaultPreset.ensure();
          const key = await presets.standingKeyFor(presetId);
          const schemas = mergeSchemas(tools.schemas(key), await catalog.schemasFor(presetId))
            .filter((schema) => schema.name !== DISCOVERY_TOOL_NAME && schema.name !== PTC_TRANSPORT_NAME);
          const selected = selectSuggestionTools(schemas, body?.toolNames);
          const otherGroupNames = normalizeGroupNames(body?.otherGroupNames);
          const timeoutMs = body?.timeoutMs === undefined
            ? undefined
            : validateGenerationTimeout(body.timeoutMs);
          const prompt = normalizeCustomPrompt(body?.prompt);
          if (body?.prompt !== undefined && prompt === undefined) throw new Error("提示词不能为空");
          return generateGroupSuggestion(llm, defaultModel, { tools: selected, otherGroupNames, prompt }, timeoutMs);
        })().then(
          (suggestion) => sendJson(res, 200, suggestion),
          (error) => sendJson(res, 400, { ok: false, message: errorMessage(error) }),
        );
      },
    });

    webServer.register({
      kind: "exact",
      path: "/tool-manager/api/auto-group",
      handler: (req, res) => {
        if (String(req.method ?? "POST").toUpperCase() !== "POST") {
          sendJson(res, 405, { ok: false, message: "method not allowed" });
          return;
        }
        void (async () => {
          const llm = context.get<LlmRuntimeLike>("llm");
          const defaultModel = context.get<AgentDefaultModelLike>("agentDefaultModel");
          if (!llm || !defaultModel) {
            throw new Error("当前 DSH 没有可用的默认模型服务，无法自动分组");
          }
          const body = asRecord(await readJsonBody(req));
          const presetId = typeof body?.presetId === "string" ? body.presetId.trim() : "";
          if (!presetId) throw new Error("presetId is required");
          const inventory = await presets.compositionInventory();
          if (!inventory.some((item) => item.id === presetId)) throw new Error(`unknown preset ${JSON.stringify(presetId)}`);
          await defaultPreset.ensure();
          const key = await presets.standingKeyFor(presetId);
          const schemas = mergeSchemas(tools.schemas(key), await catalog.schemasFor(presetId))
            .filter((schema) => schema.name !== DISCOVERY_TOOL_NAME && schema.name !== PTC_TRANSPORT_NAME);
          const selected = selectSuggestionTools(schemas, body?.toolNames);
          const otherGroupNames = normalizeGroupNames(body?.otherGroupNames);
          const timeoutMs = body?.timeoutMs === undefined
            ? undefined
            : validateGenerationTimeout(body.timeoutMs);
          const prompt = normalizeCustomPrompt(body?.prompt);
          if (body?.prompt !== undefined && prompt === undefined) throw new Error("提示词不能为空");
          return generateAutoGroups(llm, defaultModel, { tools: selected, otherGroupNames, prompt }, timeoutMs);
        })().then(
          (result) => sendJson(res, 200, result),
          (error) => sendJson(res, 400, { ok: false, message: errorMessage(error) }),
        );
      },
    });

    webServer.register({
      kind: "exact",
      path: "/tool-manager/api/save",
      handler: (req, res) => {
        if (String(req.method ?? "POST").toUpperCase() !== "POST") {
          sendJson(res, 405, { ok: false, message: "method not allowed" });
          return;
        }
        void (async () => {
          const body = asRecord(await readJsonBody(req));
          const expectedRevision = body && typeof body.expectedRevision === "number"
            ? body.expectedRevision
            : undefined;
          const next = normalizeSettings(body?.settings);
          await assertNoEmptyGroups(presets, tools, next, () => defaultPreset.ensure());
          await config.replace(next, expectedRevision);
          runtime.update(config.get());
          // `buildSnapshot` mounts every inspectable preset, so the default must
          // already be composed before it runs (see DefaultPresetMount).
          await defaultPreset.ensure();
          return buildSnapshot(presets, tools, config.get(), config.revision, config.path, catalog.schemasFor);
        })().then(
          (snapshot) => sendJson(res, 200, snapshot),
          (error) => sendJson(res, 400, { ok: false, message: errorMessage(error) }),
        );
      },
    });
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

export async function assertNoEmptyGroups(
  presets: AgentPresetsLike,
  tools: ToolRuntimeLike,
  settings: ReturnType<typeof normalizeSettings>,
  /** Composes the session default before this call mounts any other preset. */
  composeDefaultFirst?: () => Promise<void>,
): Promise<void> {
  const inventory = await presets.compositionInventory();
  const inspectable = new Map(inventory.map((item) => [item.id, item]));
  for (const [presetId, policy] of Object.entries(settings.presets)) {
    if (policy.groups.length === 0) continue;
    const composition = inspectable.get(presetId);
    if (!composition || composition.broken) continue;
    let names: string[];
    try {
      await composeDefaultFirst?.();
      const key = await presets.standingKeyFor(presetId);
      names = tools.schemas(key).map((schema) => schema.name);
    } catch {
      continue;
    }
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

function nextEventLoopTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
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
