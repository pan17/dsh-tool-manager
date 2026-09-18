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

  constructor(
    private readonly ctx: ContextLike,
    private readonly presets: AgentPresetsLike,
    initial: ToolManagerSettings,
  ) {
    this.settings = initial;
  }

  start(): void {
    this.registerDiscovery();
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
      if (!isPromptAssembly(assembly)) return assembly;
      const hidden = new Set(denyNames(this.policy(state.agent), state.baseline, state.exposures));
      if (hidden.size === 0) return assembly;
      return {
        ...assembly,
        tools: assembly.tools.filter((schema) => !hidden.has(schema.name)),
        sections: assembly.sections.filter((section) => {
          const toolName = section.name.startsWith("tool:") ? section.name.slice("tool:".length) : undefined;
          return toolName === undefined || !hidden.has(toolName);
        }),
      };
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

  private discoveryDefinition(): unknown {
    return {
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
      if (next.length === 0) return undefined;
      try {
        return scopedTools.restrict({ deny: next });
      } catch (retryError) {
        this.warn(`tool-manager restrict retry failed: ${errorMessage(retryError)}`);
        return undefined;
      }
    }
  }

  private warn(message: string): void {
    const logger = this.ctx.get<{ warn?(format: unknown, ...rest: unknown[]): void }>("logger");
    logger?.warn?.(message);
  }

  async dispose(): Promise<void> {
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

function isEnterDecision(value: unknown): value is { kind: "enter"; messages: unknown[] } {
  if (value === null || typeof value !== "object") return false;
  const record = value as { kind?: unknown; messages?: unknown };
  return record.kind === "enter" && Array.isArray(record.messages);
}

function isPromptAssembly(value: unknown): value is {
  tools: ToolSchemaLike[];
  sections: Array<{ name: string; [key: string]: unknown }>;
  [key: string]: unknown;
} {
  if (value === null || typeof value !== "object") return false;
  const record = value as { tools?: unknown; sections?: unknown };
  return Array.isArray(record.tools) && Array.isArray(record.sections);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
