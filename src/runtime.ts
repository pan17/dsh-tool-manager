import type {
  AgentLike,
  AgentPresetsLike,
  ContextLike,
  ToolRuntimeLike,
  ToolSchemaLike,
} from "./dsh.js";
import {
  applyCatalogDecision,
  catalogEntriesFromGroups,
  catalogHistory,
} from "./catalog.js";
import { restoredExposureNames } from "./exposure-history.js";
import {
  denyNames,
  findGroup,
  parseKnownRestrictable,
  policyFor,
  resolveActiveGroups,
  sameNames,
} from "./policy.js";
import {
  DISCOVERY_TOOL_NAME,
  TOOL_MANAGER_PROBE_SESSION_ID,
  type PresetToolPolicy,
  type ToolListResult,
  type ToolManagerSettings,
} from "./types.js";

interface AgentState {
  readonly agent: AgentLike;
  baseline: string[];
  baselineSchemas: ToolSchemaLike[];
  restriction?: () => void;
  guard?: () => void;
  assemblyFilter?: () => void;
  readonly exposures: Set<string>;
}

export class ToolPolicyRuntime {
  private settings: ToolManagerSettings;
  private readonly states = new Map<AgentLike, AgentState>();
  private readonly observedSchemas = new Map<string, Map<string, ToolSchemaLike>>();
  private mutating = false;
  private refreshQueued = false;
  private discoveryDisposer?: () => void;
  /**
   * Whether `system-prompt/assemble` still owns the tool declarations.
   * DSH < 0.2.2 hands over a PromptAssembly (declarations included);
   * DSH >= 0.2.2 hands over a PromptPresentation and re-attaches the
   * provider's declarations after the waterfall. Undefined until the first
   * assembly with something to hide is observed.
   */
  private declarationFiltering: boolean | undefined;
  /** Names `restrict()` refused because they are not global tools. */
  private readonly unrestrictable = new Set<string>();
  private warnedUnrestrictable = false;
  /**
   * Whether this Host filters the per-step admitted set.
   * DSH >= 0.2.2 derives declarations, PTC bindings, and execution lookup from
   * `tools.resolve()`, which is the only seam that can hide a registration made
   * in the Agent's own scope. `undefined` on older Hosts (no `resolve`).
   */
  private stepFilter: "installed" | "failed" | undefined;
  private restoreStepFilter?: () => void;

  constructor(
    private readonly ctx: ContextLike,
    private readonly presets: AgentPresetsLike,
    initial: ToolManagerSettings,
  ) {
    this.settings = initial;
  }

  start(): void {
    this.registerDiscovery();
    this.installStepFilter();
    const agents = this.ctx.get<{ list(): AgentLike[] }>("agents");
    for (const agent of agents?.list() ?? []) this.install(agent);

    this.ctx.on("agent/created", (...args: unknown[]) => {
      const payload = asCreated(args[0]);
      if (payload) this.install(payload.agent);
    });
    this.ctx.on("agent/disposed", (...args: unknown[]) => {
      const payload = asCreated(args[0]);
      if (payload) this.uninstall(payload.agent);
    });
    this.ctx.on("tools/change", () => this.queueBaselineRefresh());
    this.ctx.on("agent/pre-step", (...args: unknown[]) => this.onPreStep(args[0], args[1]));
  }

  update(next: ToolManagerSettings): void {
    this.settings = next;
    for (const state of this.states.values()) {
      const known = new Set(
        resolveActiveGroups(this.policy(state.agent), state.baseline)
          .map((group) => group.name.toLowerCase()),
      );
      for (const name of [...state.exposures]) {
        if (!known.has(name.toLowerCase())) state.exposures.delete(name);
      }
      this.reconcile(state);
    }
  }

  private install(agent: AgentLike): void {
    if (this.states.has(agent)) return;
    if (!agent.ctx.get("tools")) return;

    const baselineSchemas = this.inheritedSchemas(agent);
    const baseline = baselineSchemas.map((schema) => schema.name);
    const groups = resolveActiveGroups(this.policy(agent), baseline);
    const restored = restoredExposureNames(agent.session);
    const exposures = new Set<string>();
    for (const name of restored) {
      const group = findGroup(groups, name);
      if (group) exposures.add(group.name);
    }
    const state: AgentState = {
      agent,
      baseline,
      baselineSchemas,
      exposures,
    };
    this.states.set(agent, state);
    this.observe(state);
    this.installLocalPolicy(state);
    this.reconcile(state);
  }

  private uninstall(agent: AgentLike): void {
    const state = this.states.get(agent);
    if (!state) return;
    this.states.delete(agent);
    this.mutating = true;
    try {
      state.restriction?.();
      state.guard?.();
      state.assemblyFilter?.();
    } finally {
      this.mutating = false;
    }
  }

  private presetId(agent: AgentLike): string | undefined {
    return this.presets.composedPreset(agent.ctx);
  }

  private policy(agent: AgentLike): PresetToolPolicy {
    return policyFor(this.settings, this.presetId(agent));
  }

  private hostTools(): ToolRuntimeLike | undefined {
    return this.ctx.get<ToolRuntimeLike>("tools");
  }

  private inheritedSchemas(agent: AgentLike): ToolSchemaLike[] {
    const scopedTools = agent.ctx.get<ToolRuntimeLike>("tools");
    if (!scopedTools) return [];
    return scopedTools.schemas(agent);
  }

  private observe(state: AgentState): void {
    const presetId = this.presetId(state.agent);
    if (!presetId || state.agent.id === TOOL_MANAGER_PROBE_SESSION_ID) return;
    this.observeSchemas(presetId, state.baselineSchemas);
  }

  observeSchemas(presetId: string, schemasToAdd: readonly ToolSchemaLike[]): void {
    let schemas = this.observedSchemas.get(presetId);
    if (!schemas) {
      schemas = new Map();
      this.observedSchemas.set(presetId, schemas);
    }
    for (const schema of schemasToAdd) schemas.set(schema.name, schema);
  }

  observedSchemasFor(presetId: string): ToolSchemaLike[] {
    return [...(this.observedSchemas.get(presetId)?.values() ?? [])];
  }

  private installLocalPolicy(state: AgentState): void {
    const scopedTools = state.agent.ctx.get<ToolRuntimeLike>("tools");
    state.guard = scopedTools?.guard?.((execution) => {
      const policy = this.policy(state.agent);
      const hidden = denyNames(policy, state.baseline, state.exposures);
      if (!hidden.includes(execution.name)) return undefined;
      if (policy.disabled.includes(execution.name)) {
        return `tool ${JSON.stringify(execution.name)} is disabled by the tool-manager policy for this Agent preset`;
      }
      const open = new Set([...state.exposures].map((name) => name.toLowerCase()));
      const group = resolveActiveGroups(policy, state.baseline).find((item) => (
        !open.has(item.name.toLowerCase()) && item.tools.includes(execution.name)
      ));
      if (group) {
        return `tool ${JSON.stringify(execution.name)} belongs to on-demand group ${JSON.stringify(group.name)} which is not open; call ${DISCOVERY_TOOL_NAME} with ${JSON.stringify({ group: group.name })} first`;
      }
      return `tool ${JSON.stringify(execution.name)} is unavailable under the tool-manager policy for this Agent preset`;
    });
    state.assemblyFilter = state.agent.ctx.on("system-prompt/assemble", async (...args: unknown[]) => {
      const next = args.at(-1);
      if (typeof next !== "function") return args[0];
      const assembly = await (next as () => Promise<unknown>)();
      if (!isPromptPresentation(assembly)) return assembly;
      const hidden = new Set(denyNames(this.policy(state.agent), state.baseline, state.exposures));
      if (hidden.size === 0) return assembly;
      // DSH < 0.2.2: the waterfall receives a PromptAssembly and the returned
      // tool list is authoritative, so hiding declarations here works.
      // DSH >= 0.2.2: it receives a PromptPresentation (sections/contexts/
      // variables) and the provider's declarations are re-attached AFTER the
      // waterfall, so only section text can still be filtered. The guard keeps
      // blocking the call itself either way.
      if (Array.isArray(assembly.tools)) {
        this.declarationFiltering = true;
      } else {
        this.declarationFiltering = false;
        this.warnUnrestrictable();
      }
      const sections = assembly.sections.filter((section) => {
        const toolName = section.name.startsWith("tool:") ? section.name.slice("tool:".length) : undefined;
        return toolName === undefined || !hidden.has(toolName);
      });
      const filtered: PromptPresentationLike = { ...assembly, sections };
      if (Array.isArray(assembly.tools)) {
        filtered.tools = assembly.tools.filter((schema) => !hidden.has(schema.name));
      }
      return filtered;
    }) as (() => void) | undefined;
  }

  private queueBaselineRefresh(): void {
    if (this.mutating || this.refreshQueued) return;
    this.refreshQueued = true;
    // Tool registry changes can be emitted before asynchronous scoped plugin
    // disposal/installation has settled (notably model-selectable subagent
    // tools during Preset recomposition). Refresh on the next event-loop turn
    // so the baseline is never snapshotted from that transient gap.
    setImmediate(() => {
      this.refreshQueued = false;
      this.refreshAllBaselines();
    });
  }

  private refreshAllBaselines(): void {
    this.mutating = true;
    try {
      for (const state of this.states.values()) {
        state.restriction?.();
        state.restriction = undefined;
        const nextSchemas = this.inheritedSchemas(state.agent);
        const next = nextSchemas.map((schema) => schema.name);
        state.baselineSchemas = nextSchemas;
        if (!sameNames(state.baseline, next)) state.baseline = next;
        this.observe(state);
      }
    } finally {
      this.mutating = false;
    }
    for (const state of this.states.values()) this.reconcile(state);
  }

  private openGroup(agent: AgentLike, requestedGroup: string | undefined): ToolListResult {
    const state = this.states.get(agent);
    if (!state) throw new Error("tool manager is not attached to this Agent");
    const groups = resolveActiveGroups(this.policy(agent), state.baseline);
    const known = groups.map((item) => item.name).join(", ") || "(none)";
    if (requestedGroup === undefined || requestedGroup.trim() === "") {
      throw new Error(`group is required; known groups: ${known}`);
    }
    const group = findGroup(groups, requestedGroup);
    if (!group) {
      throw new Error(`unknown tool group ${JSON.stringify(requestedGroup)}; known groups: ${known}`);
    }
    state.exposures.add(group.name);
    this.reconcile(state);
    return {
      name: group.name,
      ...(group.description ? { description: group.description } : {}),
      tools: group.tools,
    };
  }

  private async onPreStep(payload: unknown, next: unknown): Promise<unknown> {
    const decision = typeof next === "function"
      ? await (next as () => Promise<unknown>)()
      : payload;
    if (!isEnterDecision(decision)) return decision;
    const agent = asCreated(payload)?.agent;
    if (!agent) return decision;
    if (!this.states.has(agent)) this.install(agent);
    const state = this.states.get(agent);
    if (!state) return decision;
    const groups = resolveActiveGroups(this.policy(agent), state.baseline);
    return applyCatalogDecision(
      decision,
      catalogEntriesFromGroups(groups),
      catalogHistory(agent),
    );
  }

  /**
   * Register `tool_list` on the host/global tools layer, not per agent.
   *
   * PTC prompt assembly projects inherited (global + preset-standing) tools
   * into the SDK. A scope-local registration on `agent.ctx` is visible to
   * `schemas(agent)` after the fact, but is easy to lose at `agent/created`
   * and is the wrong layer for the generated SDK. `skill` works in PTC
   * because the preset standing scope inherits it; `tool_list` must do the
   * same. Presets without active (non-empty) on-demand groups hide it with `restrict()`.
   */
  private registerDiscovery(): void {
    const tools = this.hostTools();
    if (!tools) return;
    this.mutating = true;
    try {
      this.discoveryDisposer?.();
      this.discoveryDisposer = tools.register(this.discoveryDefinition());
    } catch (error) {
      this.discoveryDisposer = undefined;
      this.warn(`tool-manager failed to register ${DISCOVERY_TOOL_NAME}: ${errorMessage(error)}`);
    } finally {
      this.mutating = false;
    }
  }

  private discoveryDefinition(): unknown {    return {
      name: DISCOVERY_TOOL_NAME,
      description:
        "Open one on-demand tool group by exact name from this session's tool-group catalog. All tools in that group become available for the rest of this session.",
      parameters: {
        type: "object",
        properties: {
          group: {
            type: "string",
            description: "Exact group name from this session's tool-group catalog.",
          },
        },
        required: ["group"],
      },
      output: {
        schema: { type: "object", additionalProperties: true },
        render: (_args: unknown, value: unknown) => [
          { type: "text", text: JSON.stringify(value, null, 2) },
        ],
      },
      execute: async (
        args: { group?: string },
        exec?: { agent?: AgentLike },
      ) => {
        const agent = exec?.agent;
        if (!agent) throw new Error("tool_list requires a calling agent");
        return this.openGroup(agent, args.group);
      },
    };
  }

  /**
   * Hide the policy's names from every per-step tool set.
   *
   * DSH 0.2.2 builds each step's admitted set from `tools.resolve()`, then
   * derives the model-facing declarations, the PTC bindings, and execution
   * lookup from it. Unlike `restrict()`, that set is NOT exempting the Agent's
   * own registrations, so this is the only seam able to hide a tool another
   * plugin registered into `agent.ctx` — the exact behaviour the prompt
   * waterfall provided before 0.2.2.
   *
   * The seam is a method on the shared `ToolsService` prototype, so one patch
   * covers the host service and every Agent-scoped derivation of it. Every
   * failure path returns the untouched set: a wrong guess here must degrade to
   * "visible but still blocked by the guard", never to a broken step.
   */
  private installStepFilter(): void {
    const tools = this.hostTools();
    if (!tools) return;
    const owner = methodOwner(tools, "resolve");
    if (!owner) return;
    const current = owner.resolve;
    if (typeof current !== "function") return;
    if ((current as PatchedMethod)[STEP_FILTER_MARK]) {
      this.stepFilter = "installed";
      return;
    }
    const runtime = this;
    const patched = (async function (this: unknown, ...args: unknown[]): Promise<unknown> {
      const set = await (current as (...inputs: unknown[]) => Promise<unknown>).apply(this, args);
      return runtime.filterStepToolSet(args[0], set);
    }) as PatchedMethod;
    patched[STEP_FILTER_MARK] = true;
    try {
      owner.resolve = patched;
      this.restoreStepFilter = () => {
        owner.resolve = current;
      };
      this.stepFilter = "installed";
    } catch (error) {
      this.stepFilter = "failed";
      this.warn(
        `tool-manager could not filter the per-step tool set (${errorMessage(error)}); tools registered in the Agent's own scope stay visible to the model`,
      );
    }
  }

  /** Remove this Agent's hidden names from one resolved step set. */
  private filterStepToolSet(context: unknown, set: unknown): unknown {
    try {
      const agent = asCreated(context)?.agent;
      if (!agent) return set;
      const state = this.states.get(agent);
      if (!state) return set;
      if (!isStepToolSet(set)) return set;
      const hidden = denyNames(this.policy(agent), state.baseline, state.exposures);
      if (hidden.length === 0) return set;
      return filterStepToolSet(set, new Set(hidden));
    } catch {
      return set;
    }
  }

  private reconcile(state: AgentState): void {
    const deny = denyNames(
      this.policy(state.agent),
      state.baseline,
      state.exposures,
    );
    this.mutating = true;
    try {
      state.restriction?.();
      state.restriction = undefined;
      if (deny.length === 0) return;
      state.restriction = this.applyDeny(state.agent, deny);
    } finally {
      this.mutating = false;
    }
  }

  private applyDeny(agent: AgentLike, deny: string[]): (() => void) | undefined {
    const scopedTools = agent.ctx.get<ToolRuntimeLike>("tools");
    if (!scopedTools) return undefined;
    try {
      return scopedTools.restrict({ deny });
    } catch (error) {
      const known = parseKnownRestrictable(error);
      if (!known) {
        this.warn(`tool-manager restrict failed: ${errorMessage(error)}`);
        return undefined;
      }
      const next = deny.filter((name) => known.has(name));
      const unrestrictable = deny.filter((name) => !known.has(name));
      if (unrestrictable.length > 0) this.noteUnrestrictable(unrestrictable);
      if (next.length === 0) return undefined;
      try {
        return scopedTools.restrict({ deny: next });
      } catch (retryError) {
        this.warn(`tool-manager restrict retry failed: ${errorMessage(retryError)}`);
        return undefined;
      }
    }
  }

  /**
   * Remember names `restrict()` refused because they are not global tools.
   *
   * These are registrations owned by the Agent's own scope (delegation and
   * scheduled-task tools are the common ones). DSH < 0.2.2 still hid them by
   * filtering the prompt assembly; DSH >= 0.2.2 cannot, so the call guard is
   * the only remaining enforcement and the model keeps seeing the name.
   */
  private noteUnrestrictable(names: readonly string[]): void {
    for (const name of names) this.unrestrictable.add(name);
    this.warnUnrestrictable();
  }

  /** Explain the remaining limitation once, and only when it actually bites. */
  private warnUnrestrictable(): void {
    if (this.declarationFiltering !== false || this.warnedUnrestrictable) return;
    // The per-step filter already removes these names from everything the
    // model sees, so there is nothing to report.
    if (this.stepFilter === "installed") return;
    if (this.unrestrictable.size === 0) return;
    this.warnedUnrestrictable = true;
    const names = [...this.unrestrictable].sort();
    this.warn(
      `tool-manager: this DSH builds the system prompt without tool declarations, so ${names.length} Agent-scoped tool(s) — ${names.join(", ")} — stay visible to the model even when disabled or assigned to an on-demand group. Calls are still blocked by the tool-manager guard; only tools registered outside the Agent's own scope can be hidden from the prompt.`,
    );
  }

  private warn(message: string): void {
    const logger = this.ctx.get<{ warn?(format: unknown, ...rest: unknown[]): void }>("logger");
    logger?.warn?.(message);
  }

  async dispose(): Promise<void> {
    this.restoreStepFilter?.();
    this.restoreStepFilter = undefined;
    for (const agent of [...this.states.keys()]) this.uninstall(agent);
    this.mutating = true;
    try {
      this.discoveryDisposer?.();
      this.discoveryDisposer = undefined;
    } finally {
      this.mutating = false;
    }
  }
}

function asCreated(value: unknown): { agent: AgentLike } | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const agent = (value as { agent?: AgentLike }).agent;
  if (!agent || typeof agent !== "object" || !("ctx" in agent)) return undefined;
  return { agent };
}

/** Cross-reload marker: two wrappers must never stack on one Host. */
const STEP_FILTER_MARK = Symbol.for("dsh-tool-manager.step-filter");

type PatchedMethod = ((this: unknown, ...args: unknown[]) => Promise<unknown>) & Record<symbol, unknown>;

/** One step's admitted registrations, as `tools.resolve()` returns it. */
interface StepToolSetLike {
  dispose(): void;
  view(scope?: unknown): ReadonlyMap<string, unknown>;
}

function isStepToolSet(value: unknown): value is StepToolSetLike {
  if (value === null || typeof value !== "object") return false;
  const record = value as { view?: unknown; dispose?: unknown };
  return typeof record.view === "function" && typeof record.dispose === "function";
}

/**
 * Re-project one step set without the hidden names.
 *
 * Everything downstream — prompt declarations, PTC bindings, and the
 * executable lookup — reads this map, so dropping a registration here is the
 * 0.2.2 equivalent of removing it from the prompt assembly.
 */
function filterStepToolSet(set: StepToolSetLike, hidden: ReadonlySet<string>): StepToolSetLike {
  return {
    dispose: () => set.dispose(),
    view(scope?: unknown) {
      const view = set.view(scope);
      const kept = new Map<string, unknown>();
      for (const [name, definition] of view) {
        if (!hidden.has(name)) kept.set(name, definition);
      }
      return kept;
    },
  };
}

/**
 * The object in `value`'s prototype chain that owns `name`.
 *
 * Services in Cordis derive per-context instances with `Object.create(service)`,
 * so the owning prototype is the single place a patch reaches every Agent.
 */
function methodOwner(value: unknown, name: string): Record<string, unknown> | undefined {
  let owner = value as object | null;
  while (owner !== null && owner !== Object.prototype) {
    if (Object.prototype.hasOwnProperty.call(owner, name)) return owner as Record<string, unknown>;
    owner = Object.getPrototypeOf(owner) as object | null;
  }
  return undefined;
}

function isEnterDecision(value: unknown): value is { kind: "enter"; messages: unknown[] } {
  if (value === null || typeof value !== "object") return false;
  const record = value as { kind?: unknown; messages?: unknown };
  return record.kind === "enter" && Array.isArray(record.messages);
}

/**
 * One assembly as the waterfall receives it.
 *
 * `tools` is present on DSH < 0.2.2 (`PromptAssembly`) and absent from
 * 0.2.2 onward (`PromptPresentation`), where the tool registry re-attaches the
 * declarations after the waterfall. Everything else (sections, contexts,
 * variables) survives both shapes.
 */
interface PromptPresentationLike {
  sections: Array<{ name: string; [key: string]: unknown }>;
  tools?: ToolSchemaLike[];
  [key: string]: unknown;
}

function isPromptPresentation(value: unknown): value is PromptPresentationLike {
  if (value === null || typeof value !== "object") return false;
  const record = value as { sections?: unknown };
  return Array.isArray(record.sections);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
