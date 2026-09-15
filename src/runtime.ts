import type {
  AgentLike,
  AgentPresetsLike,
  ContextLike,
  ToolRuntimeLike,
} from "./dsh.js";
import {
  applyCatalogDecision,
  catalogEntriesFromGroups,
  catalogHistory,
} from "./catalog.js";
import {
  denyNames,
  findGroup,
  parseKnownRestrictable,
  policyFor,
  resolveGroups,
  sameNames,
} from "./policy.js";
import {
  DISCOVERY_TOOL_NAME,
  PTC_TRANSPORT_NAME,
  type PresetToolPolicy,
  type ToolListResult,
  type ToolManagerSettings,
} from "./types.js";

interface AgentState {
  readonly agent: AgentLike;
  baseline: string[];
  restriction?: () => void;
  readonly exposures: Set<string>;
  toolListDisposer?: () => void;
  discoverySignature?: string;
}

export class ToolPolicyRuntime {
  private settings: ToolManagerSettings;
  private readonly states = new Map<AgentLike, AgentState>();
  private mutating = false;
  private refreshQueued = false;

  constructor(
    private readonly ctx: ContextLike,
    private readonly presets: AgentPresetsLike,
    initial: ToolManagerSettings,
  ) {
    this.settings = initial;
  }

  start(): void {
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
      const known = new Set(this.policy(state.agent).groups.map((group) => group.name.toLowerCase()));
      for (const name of [...state.exposures]) {
        if (!known.has(name.toLowerCase())) state.exposures.delete(name);
      }
      this.syncDiscovery(state);
      this.reconcile(state);
    }
  }

  private install(agent: AgentLike): void {
    if (this.states.has(agent)) return;
    if (!agent.ctx.get("tools")) return;

    const state: AgentState = {
      agent,
      baseline: this.inheritedNames(agent),
      exposures: new Set(),
    };
    this.states.set(agent, state);
    this.syncDiscovery(state);
    this.reconcile(state);
  }

  private uninstall(agent: AgentLike): void {
    const state = this.states.get(agent);
    if (!state) return;
    this.states.delete(agent);
    this.mutating = true;
    try {
      this.dropDiscovery(state);
      state.restriction?.();
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

  private inheritedNames(agent: AgentLike): string[] {
    const scopedTools = agent.ctx.get<ToolRuntimeLike>("tools");
    if (!scopedTools) return [];
    return scopedTools
      .schemas(agent)
      .map((schema) => schema.name)
      .filter((name) => name !== DISCOVERY_TOOL_NAME && name !== PTC_TRANSPORT_NAME);
  }

  private queueBaselineRefresh(): void {
    if (this.mutating || this.refreshQueued) return;
    this.refreshQueued = true;
    queueMicrotask(() => {
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
        const next = this.inheritedNames(state.agent);
        if (!sameNames(state.baseline, next)) state.baseline = next;
      }
    } finally {
      this.mutating = false;
    }
    for (const state of this.states.values()) this.reconcile(state);
  }

  private openGroup(agent: AgentLike, requestedGroup: string | undefined): ToolListResult {
    const state = this.states.get(agent);
    if (!state) throw new Error("tool manager is not attached to this Agent");
    const groups = resolveGroups(this.policy(agent), state.baseline);
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
    const groups = resolveGroups(this.policy(agent), state.baseline);
    return applyCatalogDecision(
      decision,
      catalogEntriesFromGroups(groups),
      catalogHistory(agent),
    );
  }

  private syncDiscovery(state: AgentState): void {
    const policy = this.policy(state.agent);
    const wantsDiscovery = policy.groups.length > 0;
    const signature = discoverySignature(policy);
    this.mutating = true;
    try {
      if (wantsDiscovery && state.toolListDisposer && state.discoverySignature !== signature) {
        state.toolListDisposer();
        state.toolListDisposer = undefined;
      }
      if (wantsDiscovery && !state.toolListDisposer) {
        const scopedTools = state.agent.ctx.get<ToolRuntimeLike>("tools");
        if (scopedTools) {
          const known = policy.groups.map((group) => group.name).join(", ") || "(none)";
          state.toolListDisposer = scopedTools.register({
            name: DISCOVERY_TOOL_NAME,
            description:
              `Open one on-demand tool group by name. All tools in that group become available for the rest of this session. Known groups: ${known}.`,
            parameters: {
              type: "object",
              properties: {
                group: {
                  type: "string",
                  description: `Group name to open. Known groups: ${known}.`,
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
            execute: async (args: { group?: string }) => this.openGroup(state.agent, args.group),
          });
          state.discoverySignature = signature;
        }
      }
      if (!wantsDiscovery && state.toolListDisposer) {
        state.toolListDisposer();
        state.toolListDisposer = undefined;
        state.discoverySignature = undefined;
        state.exposures.clear();
      }
    } finally {
      this.mutating = false;
    }
  }

  private dropDiscovery(state: AgentState): void {
    state.toolListDisposer?.();
    state.toolListDisposer = undefined;
    state.discoverySignature = undefined;
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

function discoverySignature(policy: PresetToolPolicy): string {
  return policy.groups
    .map((group) => `${group.name}\0${group.description ?? ""}`)
    .join("\n");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
