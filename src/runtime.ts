import type {
  AgentLike,
  AgentPresetsLike,
  AgentPresetsSource,
  ContextLike,
  ToolRuntimeLike,
  ToolSchemaLike,
} from "./dsh.js";
import { presetForAgent, resolvePresets } from "./dsh.js";
import {
  applyCatalogDecision,
  catalogEntriesFromGroups,
  catalogHistory,
  isEnterDecision,
} from "./catalog.js";
import { restoredExposureNames } from "./exposure-history.js";
import { PresetBindingRepair, type RepairAgentDiagnostics, type RepairDiagnostics } from "./preset-repair.js";
import type { UserNoticeInput } from "./notices.js";
import {
  denyNames,
  findGroup,
  matchesAnyPattern,
  parseKnownRestrictable,
  policyFor,
  resolveActiveGroups,
  sameNames,
} from "./policy.js";
import {
  DISCOVERY_TOOL_NAME,
  PTC_TRANSPORT_NAME,
  TOOL_MANAGER_PROBE_SESSION_ID,
  type PresetToolPolicy,
  type ToolListResult,
  type ToolManagerSettings,
} from "./types.js";

interface AgentState {
  readonly agent: AgentLike;
  /**
   * Last preset this Agent was observed on.
   *
   * DSH binds an Agent to a revision of the registry instance that composed it.
   * When that instance is reloaded the new one holds no such binding and
   * reports no preset for the Agent, which would read as "no policy" — every
   * tool the user disabled would come back. The remembered id keeps the policy
   * the Session was actually running under in force.
   */
  preset?: string;
  /** Whether the lost registry binding was already explained to this Session. */
  bindingNotice?: boolean;
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
  /** Re-attaches Sessions to a registry instance that replaced their own. */
  private readonly repairs: PresetBindingRepair;
  /** Sessions whose re-attach already failed once, so the log stays readable. */
  private readonly healFailures = new Set<string>();
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
  /** The registry instance the observed schemas belong to. */
  private presetsInstance?: AgentPresetsLike;

  constructor(
    private readonly ctx: ContextLike,
    /** The live registry, or a resolver: DSH replaces the instance on reload. */
    private readonly presets: AgentPresetsSource,
    initial: ToolManagerSettings,
    /** The reader's inbox: what the model cannot fix and the person must see. */
    private readonly onUserNotice?: (notice: UserNoticeInput) => void,
    /** Called when a repair succeeds, so its transient notice can be withdrawn. */
    private readonly onBindingHealed?: (sessionId: string | undefined, presetId: string | undefined) => void,
  ) {
    this.settings = initial;
    this.repairs = new PresetBindingRepair({ warn: (message) => this.warn(message) });
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
    const presets = resolvePresets(this.presets);
    if (presets !== undefined) {
      this.retain(presets);
      this.repairs.observe(presets);
      const live = presets.composedPreset(agent.ctx);
      if (live !== undefined) {
        const state = this.states.get(agent);
        if (state) state.preset = live;
        return live;
      }
      // DSH binds a Session's preset composition when its Agent is created, and
      // `dsh-scope` refuses to re-link a key that already has a parent. A
      // reloaded registry therefore cannot answer for Agents composed by the
      // instance it replaced; the Session log still names the preset those
      // Sessions run, and their policy has to keep applying to it.
      const declared = this.declaredPreset(presets, agent);
      if (declared !== undefined) {
        const state = this.states.get(agent);
        if (state) state.preset = declared;
        return declared;
      }
    }
    // No live instance at all: keep the preset this Agent was last seen on
    // rather than dropping its policy.
    return this.states.get(agent)?.preset;
  }

  /** The preset a Session runs, per the Session log, when the live registry has no binding. */
  private declaredPreset(presets: AgentPresetsLike, agent: AgentLike): string | undefined {
    return presetForAgent(presets, agent);
  }

  /** Whether the live registry lost this Agent's preset binding to a reload. */
  private lostBinding(state: AgentState): boolean {
    const presets = resolvePresets(this.presets);
    if (presets === undefined) return false;
    if (presets.composedPreset(state.agent.ctx) !== undefined) return false;
    // The Session projection belongs to the instance that was replaced and is
    // rebuilt lazily, so on the first step after a reload it can still be empty.
    // The binding the Agent lost names the preset either way.
    return this.declaredPreset(presets, state.agent) !== undefined
      || state.preset !== undefined
      || this.repairs.boundPreset(state.agent) !== undefined;
  }

  /**
   * Drop observations taken through a registry instance DSH has replaced.
   *
   * A preset id identifies a composition of ONE registry instance. After a
   * reload the same id is a different composition, so schemas observed under
   * the retired instance would describe tools no live preset owns.
   */
  private retain(presets: AgentPresetsLike): void {
    if (this.presetsInstance === presets) return;
    this.presetsInstance = presets;
    this.observedSchemas.clear();
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
      const policy = this.policy(state.agent);
      const hidden = new Set(denyNames(policy, state.baseline, state.exposures));
      const folded = foldedGroups(policy, state.exposures);
      if (hidden.size === 0 && folded.length === 0 && policy.disabled.length === 0) return assembly;
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
      const sections = assembly.sections.filter((section) => (
        !sectionHidden(section.name, state.baseline, policy, folded, hidden)
      ));
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

  /**
   * Adopt names the live inherited surface gained since the snapshot.
   *
   * The baseline is a snapshot, and a snapshot can miss a registration that
   * lands outside a `tools/change` edge: a plugin installed while the runtime
   * was still starting, a standing Preset re-mounting, or a composition reload
   * that re-registers tools without emitting a change. A stale baseline makes a
   * saved on-demand group resolve to zero tools, so the group silently drops
   * out of the catalog and its tools stay visible — the "the group only works
   * after restarting DSH" report. One live `schemas(agent)` read per step is a
   * map walk and keeps the policy, the catalog and the step on one tool set.
   *
   * The visible surface is read first: this Agent's own restriction only ever
   * removes names, so a name it shows that the snapshot lacks is proof of a new
   * registration. Only then is the restriction lifted for a full read — adopting
   * the restricted view would drop every grouped tool from the snapshot and
   * `reconcile()` would then un-hide them. A surface that merely shrank can be
   * the transient gap of a composition swap, which the debounced `tools/change`
   * refresh in `refreshAllBaselines()` settles.
   * @param state - the Agent whose baseline may have drifted.
   * @returns whether the baseline changed.
   */
  private syncBaseline(state: AgentState): boolean {
    const scopedTools = state.agent.ctx.get<ToolRuntimeLike>("tools");
    // A missing service is a reload window, not an empty tool set.
    if (!scopedTools) return false;
    let nextSchemas: ToolSchemaLike[];
    try {
      const known = new Set(state.baseline);
      if (scopedTools.schemas(state.agent).every((schema) => known.has(schema.name))) return false;
      this.mutating = true;
      try {
        state.restriction?.();
        state.restriction = undefined;
        nextSchemas = scopedTools.schemas(state.agent);
      } finally {
        this.mutating = false;
      }
    } catch {
      // A refresh must never break the step; the guard still enforces the policy.
      return false;
    }
    state.baseline = nextSchemas.map((schema) => schema.name);
    state.baselineSchemas = nextSchemas;
    this.observe(state);
    this.reconcile(state);
    return true;
  }

  /** Refresh the baseline of the Agent a `tools.resolve()` call belongs to. */
  private syncStepBaseline(context: unknown): void {
    try {
      const agent = asCreated(context)?.agent;
      if (!agent) return;
      const state = this.states.get(agent);
      if (!state) return;
      this.syncBaseline(state);
    } catch {
      // A refresh must never break the step; the guard still enforces the policy.
    }
  }

  private openGroup(agent: AgentLike, requestedGroup: string | undefined): ToolListResult {
    const state = this.states.get(agent);
    if (!state) throw new Error("tool manager is not attached to this Agent");
    // `tool_list` is the last chance to see a group whose tools appeared after
    // this Agent's snapshot; resolve it against the live surface, not the old one.
    this.syncBaseline(state);
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
    await this.healBinding(state);
    // Nothing is appended to the step: a lost tool set is the reader's problem
    // to act on, and the reader is reached through the notice banner instead of
    // through the transcript.
    this.reportLostBinding(state);
    // Refresh before the catalog decision: a tool registered after this Agent's
    // snapshot would otherwise leave its on-demand group empty here, and the
    // model would never learn the group exists.
    this.syncBaseline(state);
    const groups = resolveActiveGroups(this.policy(agent), state.baseline);
    return applyCatalogDecision(
      decision,
      catalogEntriesFromGroups(groups),
      catalogHistory(agent),
    );
  }

  /**
   * Re-attach this Session to a registry instance that replaced its own.
   *
   * A registry reload disposes the standing composition the Agent's scope
   * points at, so the Session silently drops to root-bundle tools. Re-linking
   * the Agent's ancestry to the live instance's revision restores them before
   * this step resolves its tool set, which is the only point where it can
   * happen without rebuilding the Agent (and therefore without a restart).
   * @param state - the Agent whose preset binding may have been retired.
   */
  /** What the registry re-attach can see, for the diagnostic endpoint. */
  repairDiagnostics(): RepairDiagnostics & { agents: RepairAgentDiagnostics[] } {
    const presets = resolvePresets(this.presets);
    if (presets !== undefined) this.repairs.observe(presets);
    return { ...this.repairs.diagnostics(), agents: this.diagnoseAgents(presets) };
  }

  /** One row per live Agent: what it resolves now, and what it should resolve. */
  private diagnoseAgents(presets: AgentPresetsLike | undefined): RepairAgentDiagnostics[] {
    const agents = this.ctx.get<{ list(): AgentLike[] }>("agents");
    const rows: RepairAgentDiagnostics[] = [];
    for (const agent of agents?.list() ?? []) {
      const state = this.states.get(agent);
      let composed: string | undefined;
      let declared: string | undefined;
      try {
        composed = presets?.composedPreset(agent.ctx);
      } catch {
        composed = undefined;
      }
      if (presets !== undefined) declared = this.declaredPreset(presets, agent);
      rows.push({
        ...(agent.id === undefined ? {} : { id: agent.id }),
        ...(composed === undefined ? {} : { composed }),
        ...(declared === undefined ? {} : { declared }),
        ...(state?.preset === undefined ? {} : { preset: state.preset }),
        ...(state === undefined ? {} : { baseline: state.baseline.length }),
      });
    }
    return rows;
  }

  private async healBinding(state: AgentState): Promise<void> {
    const presets = resolvePresets(this.presets);
    if (presets === undefined) return;
    this.repairs.observe(presets);
    if (presets.composedPreset(state.agent.ctx) !== undefined) return;
    const presetId = this.declaredPreset(presets, state.agent) ?? state.preset ?? this.repairs.boundPreset(state.agent);
    let repaired = false;
    for (let attempt = 0; attempt < RELINK_ATTEMPTS && !repaired; attempt += 1) {
      try {
        repaired = await withTimeout(this.repairs.relink(state.agent, presetId), RELINK_TIMEOUT_MS);
      } catch (error) {
        // A replacement instance registers its definitions asynchronously, so the
        // first attempt after a reload can miss the preset. Give it a moment and
        // try again in this same step, so the tool set never has to disappear.
        const transient = /not-found|not ready|not registered/i.test(errorMessage(error));
        if (transient && attempt + 1 < RELINK_ATTEMPTS) {
          await sleep(RELINK_RETRY_MS);
          continue;
        }
        // Retry on later steps too, but say so once: a warning per step would
        // bury the log.
        const key = `${state.agent.id ?? "?"}|${presetId}`;
        if (!this.healFailures.has(key)) {
          this.healFailures.add(key);
          this.warn(
            `tool-manager: could not re-attach Session ${state.agent.id ?? "<unknown>"} to preset ${JSON.stringify(presetId)}: ${errorMessage(error)}`,
          );
        }
        return;
      }
    }
    if (!repaired) return;
    const restored = presetId ?? this.repairs.boundPreset(state.agent);
    if (restored !== undefined) state.preset = restored;
    state.bindingNotice = undefined;
    this.healFailures.delete(`${state.agent.id ?? "?"}|${presetId}`);
    this.onBindingHealed?.(state.agent.id, restored);
    this.warn(
      `tool-manager: re-attached Session ${state.agent.id ?? "<unknown>"} to preset ${JSON.stringify(presetId)} after the agent preset registry was reloaded`,
    );
    // The Session's tool set just grew back: re-snapshot it so policy, groups
    // and the on-demand catalog describe the restored composition.
    this.refreshAllBaselines();
  }

  /**
   * Tell the person that a Session lost its tools and cannot get them back.
   *
   * `healBinding` runs first and is the preferred outcome; this is the residual
   * case (the handles died with the replaced instance, or the preset no longer
   * exists). Then only a rebuilt Agent helps, and the reader is the one who has
   * to act, so the notice goes to the banner — never into the transcript: a
   * model-side reminder cannot restore a tool set and is easy to miss.
   */
  private reportLostBinding(state: AgentState): void {
    if (state.bindingNotice === true) return;
    if (!this.lostBinding(state)) return;
    const presets = resolvePresets(this.presets);
    const presetId = (presets === undefined ? undefined : this.declaredPreset(presets, state.agent))
      ?? state.preset
      ?? this.repairs.boundPreset(state.agent);
    state.bindingNotice = true;
    const sessionId = state.agent.id;
    this.onUserNotice?.({
      kind: "failed",
      ...(sessionId === undefined ? {} : { sessionId }),
      ...(presetId === undefined ? {} : { presetId }),
      message:
        `会话「${sessionId ?? "未知"}」在 agent preset 注册表重载后丢失了 preset ${presetId ?? "（未知）"} 提供的工具，` +
        "插件没能自动重新挂载（旧注册表的绑定句柄已随实例销毁，或该 preset 已不存在）。" +
        "需要重启 DSH（托盘图标 →「退出 DeepSeek Harness」→ 重新打开）才能恢复这些工具；切换会话无效。",
    });
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
      // Before the host resolves the set: a tool registered after this Agent's
      // snapshot must join its on-demand group now, or the group stays empty and
      // the tool stays admitted for this step.
      runtime.syncStepBaseline(args[0]);
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

/** Wait `ms` without holding the event loop open. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

/** Settle `work` within `ms`, rejecting rather than stalling a model step. */
async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
function asCreated(value: unknown): { agent: AgentLike } | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const agent = (value as { agent?: AgentLike }).agent;
  if (!agent || typeof agent !== "object" || !("ctx" in agent)) return undefined;
  return { agent };
}

/** How long a pre-step waits for a registry re-link before giving up. */
const RELINK_TIMEOUT_MS = 3000;

/** How many times one step tries to re-attach before it defers to the next. */
const RELINK_ATTEMPTS = 3;

/** Pause between attempts: enough for a replacement to finish registering. */
const RELINK_RETRY_MS = 60;

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

/**
 * Shared MCP resource tools published by `@deepseek-ai/dsh-mcp-resources`.
 *
 * The package advertises all three in one `mcp-resource-servers` section, so
 * the section is stale only once the whole family is hidden.
 */
const MCP_RESOURCE_TOOLS = [
  "list_mcp_resources",
  "list_mcp_resource_templates",
  "read_mcp_resource",
] as const;

/**
 * Whether a prompt section exists only to advertise tools that are all hidden.
 *
 * A section that only advertises tools is dead weight once every one of them is
 * hidden: the model reads an instruction it cannot follow, because the
 * declaration and the call are both gone. DSH links `tool:<name>` sections to
 * exactly one tool; other producers encode the family in the section name, and
 * this resolver extends the same rule by convention instead of hard-coding one
 * group or one server:
 * - `tool:<name>` — DSH's per-tool description section;
 * - `mcp:<server>` — `@deepseek-ai/dsh-mcp-client` instructions for one server,
 *   covering every `mcp__<server>__*` tool it registered;
 * - `mcp-resource-servers` — `@deepseek-ai/dsh-mcp-resources` hint for the
 *   shared resource tools above.
 *
 * Membership is read from the baseline *and* from the preset policy. A child
 * Agent can start with a tool surface already narrowed by an upstream
 * `tools.restrict()`, so its baseline may not name a single member of a folded
 * group even though the section is still emitted globally (issue #3).
 *
 * @param name - prompt section name.
 * @param baseline - every tool name this Agent inherited.
 * @param policy - the preset policy for this Agent.
 * @param folded - the policy's groups that are not open in this session.
 * @param hidden - names already denied by `denyNames()` for this Agent.
 * @returns whether the section must be dropped from the prompt.
 */
function sectionHidden(
  name: string,
  baseline: readonly string[],
  policy: PresetToolPolicy,
  folded: readonly PresetToolPolicy["groups"][number][],
  hidden: ReadonlySet<string>,
): boolean {
  const owners = sectionToolOwners(name, baseline, policy);
  // Not a tool section: persona, plan policy, delegation rules, and every other
  // prose contribution is never filtered by this plugin.
  if (owners === undefined) return false;
  if (owners.length === 0) {
    // A namespace section whose tools this Agent never inherited. Only a folded
    // pattern that spells out this very namespace proves it stale.
    const prefix = mcpServerPrefix(name);
    return prefix !== undefined && folded.some((group) => (
      group.patterns.some((pattern) => pattern.startsWith(prefix) && pattern.length > prefix.length)
    ));
  }
  return owners.every((tool) => hidden.has(tool) || policyHides(policy, folded, tool));
}

/**
 * The tools a prompt section exists to introduce.
 *
 * @param name - prompt section name.
 * @param registeredNames - every tool name in the Agent's baseline.
 * @param policy - the preset policy, whose literal names count as members.
 * @returns the owned tool names (possibly empty when the family is known only
 *   by a wildcard pattern), or `undefined` when the section is not owned by a
 *   tool family and must always be kept.
 */
function sectionToolOwners(
  name: string,
  registeredNames: readonly string[],
  policy: PresetToolPolicy,
): readonly string[] | undefined {
  if (name.startsWith("tool:")) return [name.slice("tool:".length)];
  if (name === "mcp-resource-servers") return MCP_RESOURCE_TOOLS;
  const prefix = mcpServerPrefix(name);
  if (prefix === undefined) return undefined;
  const members = new Set(registeredNames.filter((tool) => tool.startsWith(prefix)));
  for (const declared of declaredToolNames(policy)) {
    if (declared.startsWith(prefix)) members.add(declared);
  }
  return [...members];
}

/** The `mcp__<server>__` tool-name prefix an `mcp:<server>` section covers. */
function mcpServerPrefix(sectionName: string): string | undefined {
  if (!sectionName.startsWith("mcp:")) return undefined;
  const server = sectionName.slice("mcp:".length);
  return server ? `mcp__${server}__` : undefined;
}

/** Every tool name the policy spells out, including exact group patterns. */
function declaredToolNames(policy: PresetToolPolicy): string[] {
  const names = [...policy.disabled];
  for (const group of policy.groups) {
    for (const pattern of group.patterns) {
      if (!pattern.includes("*")) names.push(pattern);
    }
  }
  return names;
}

/** Groups that are not open in this Agent, so their members stay folded. */
function foldedGroups(
  policy: PresetToolPolicy,
  exposures: ReadonlySet<string>,
): PresetToolPolicy["groups"] {
  const open = new Set([...exposures].map((name) => name.toLowerCase()));
  return policy.groups.filter((group) => !open.has(group.name.toLowerCase()));
}

/**
 * Whether the preset policy alone hides a tool, independent of the tool
 * surface this Agent inherited.
 *
 * `denyNames()` can only deny names that are present, because `restrict()`
 * rejects unknown ones. A section must not depend on that: the child Agent of
 * a delegation inherits a narrowed tool set before this plugin installs, so
 * the folded group resolves to zero tools there while the section — registered
 * globally by the tool's own plugin — is still emitted for everyone.
 */
function policyHides(
  policy: PresetToolPolicy,
  folded: readonly PresetToolPolicy["groups"][number][],
  toolName: string,
): boolean {
  // Mirrors `denyNames()`: the PTC transport and the discovery tool are never
  // folded, so neither may lose its section to a stray group pattern.
  if (toolName === PTC_TRANSPORT_NAME || toolName === DISCOVERY_TOOL_NAME) return false;
  if (policy.disabled.includes(toolName)) return true;
  return folded.some((group) => matchesAnyPattern(toolName, group.patterns));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

