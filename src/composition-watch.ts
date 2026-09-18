/**
 * Generic re-calibration for Preset switches.
 *
 * WHY THIS EXISTS
 * `agentPresets.recompose()` re-links one Agent and dispatches exactly ONE
 * `tools/change`. Every preset composition that installs per-Agent tools
 * reconciles on that event: the composition the Agent LEFT disposes its
 * registrations (asynchronously) while the composition it JOINED claims the
 * same names. Which side wins is decided by listener registration order — the
 * order presets were mounted in — and nothing in a plugin owns that order.
 *
 * Losing that race throws inside the joining composition's `ctx.inject`, and
 * DSH caches the failed fiber per Agent, so the tools stay unregistered for
 * that Agent until the Agent object is rebuilt (Session reopen, Host restart).
 *
 * WHAT THIS DOES INSTEAD
 * Stop predicting the race and make its outcome irrelevant: after every mode
 * switch, re-calibrate the Session by composing one other Preset and then
 * composing the intended one again. That round trip makes the previous
 * composition observe "the Agent left me" (clearing whatever the failed
 * attempt cached) and then lets the intended composition install into an Agent
 * that holds no competing registration. It is deliberately blind to tool names:
 * anything any plugin installs per Agent is re-installed the same way.
 *
 * SAFETY
 * A re-calibration is only attempted on a Session that has not started a turn —
 * DSH itself refuses to re-link a started Session, and a running turn must not
 * have its preset changed under it. The two legs are sequential and the second
 * one always runs: leaving an Agent on the transit Preset would be worse than
 * the missing tools this repairs.
 */

import type {
  AgentLike,
  AgentPresetsLike,
  AgentSessionLike,
  ContextLike,
  PresetCompositionLike,
  ToolRuntimeLike,
  ToolSchemaLike,
} from "./dsh.js";

/** Session events that prove a Session is no longer blank. */
const STARTED_EVENT_TYPES = new Set(["turn/start", "step/start", "user/message", "assistant/message"]);

/** A blank Session holds a handful of events; a long log needs no scan. */
const BLANK_SCAN_LIMIT = 400;

interface Observation {
  preset: string | undefined;
  names: readonly string[];
}

interface Recalibration {
  agent: AgentLike;
  target: string;
}

export interface CompositionWatchOptions {
  presets: AgentPresetsLike;
  /** Live Agents, in any order. */
  agents: () => readonly AgentLike[];
  tools: () => ToolRuntimeLike | undefined;
  /**
   * Tool names a freshly composed Agent of one Preset would hold. Used only to
   * verify a suspected loss, never to decide a re-calibration.
   */
  probe?: (presetId: string) => Promise<readonly ToolSchemaLike[]>;
  /**
   * True when this plugin's own policy — not a lost registration — hides the
   * name (a disabled tool, an on-demand group member, the plugin's own tools).
   */
  explainedLoss?: (presetId: string | undefined, name: string) => boolean;
  warn: (message: string) => void;
  /** Informational sink; falls back to `warn` when the Host has no info level. */
  info?: (message: string) => void;
  /** Agent excluded from watching — the plugin's own probe Session. */
  excludeAgentId?: string;
  /** Quiet period after `tools/change`, so reconcilers can settle first. */
  debounceMs?: number;
  /** Lets one composition's registrations settle before the next leg. */
  settle?: () => Promise<void>;
}

/**
 * Watches live Agents across Preset switches and re-calibrates the Sessions a
 * switch may have left short of tools.
 */
export class CompositionWatch {
  private readonly observations = new Map<string, Observation>();
  private readonly pending = new Map<string, Recalibration>();
  private readonly busy = new Set<string>();
  private readonly reported = new Set<string>();
  private queue: Promise<void> = Promise.resolve();
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;

  constructor(private readonly options: CompositionWatchOptions) {}

  /** Subscribe to the events that can change an Agent's tool set. */
  start(context: ContextLike): void {
    context.on("tools/change", () => this.schedule());
    context.on("agent/disposed", (payload: unknown) => {
      const agent = disposedAgent(payload);
      if (agent?.id === undefined) return;
      this.observations.delete(agent.id);
      this.pending.delete(agent.id);
      this.busy.delete(agent.id);
    });
    // Sessions that were already live when this plugin loaded get a baseline
    // too, so their next mode switch is seen as a switch rather than as first
    // contact. The first look at any Agent only records — the inspection has
    // nothing to compare against yet.
    this.schedule();
  }

  /**
   * Inspect every live Agent now, then run the re-calibrations that inspection
   * queued. Two concurrent callers are serialized, so an inspection never
   * overlaps a re-calibration.
   */
  flush(): Promise<void> {
    const next = this.queue.then(() => this.drain(), () => this.drain());
    this.queue = next.then(() => undefined, () => undefined);
    return next;
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
    this.pending.clear();
  }

  private schedule(): void {
    if (this.disposed || this.timer !== undefined) return;
    const delay = this.options.debounceMs ?? 120;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush().catch(() => undefined);
    }, delay);
    // A pending inspection must never hold the Host's event loop open.
    this.timer.unref?.();
  }

  private clearTimer(): void {
    if (this.timer === undefined) return;
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private async drain(): Promise<void> {
    this.clearTimer();
    if (this.disposed) return;
    await this.inspect();
    for (;;) {
      const entry = firstEntry(this.pending);
      if (entry === undefined) return;
      const [agentId, job] = entry;
      this.pending.delete(agentId);
      this.busy.add(agentId);
      try {
        await this.recalibrate(job);
      } catch (error) {
        this.options.warn(`tool-manager: re-calibrating Session ${agentId} failed: ${errorMessage(error)}`);
      } finally {
        this.busy.delete(agentId);
      }
    }
  }

  /** Compare every live Agent's tool set with the last one this class saw. */
  private async inspect(): Promise<void> {
    const tools = this.options.tools();
    if (tools === undefined) return;
    for (const agent of this.options.agents()) {
      const agentId = agent.id;
      if (agentId === undefined || agentId === this.options.excludeAgentId) continue;
      if (this.busy.has(agentId)) continue;
      const names = toolNames(tools, agent);
      if (names === undefined) continue;
      const preset = this.options.presets.composedPreset(agent.ctx);
      const previous = this.observations.get(agentId);
      this.observations.set(agentId, { preset, names });
      if (previous === undefined) continue;
      if (previous.preset !== preset) {
        // A mode switch: the tool set is expected to change, and whether the
        // joining composition won its registration race is not knowable from
        // here. Re-calibrate rather than guess.
        if (preset !== undefined) this.pending.set(agentId, { agent, target: preset });
        continue;
      }
      const lost = previous.names.filter((name) => !names.includes(name));
      if (lost.length === 0) continue;
      const unexplained = lost.filter((name) => !(this.options.explainedLoss?.(preset, name) ?? false));
      if (unexplained.length > 0) void this.reportLoss(agent, preset, unexplained);
    }
  }

  /**
   * Report an Agent that lost tools without a mode switch — the shape a failed
   * per-Agent install leaves behind. A name the reference Agent of the same
   * Preset also lacks is a composition-level change, not this defect.
   */
  private async reportLoss(
    agent: AgentLike,
    preset: string | undefined,
    lost: readonly string[],
  ): Promise<void> {
    const key = `${agent.id ?? "?"}|${preset ?? "?"}|${[...lost].sort().join(",")}`;
    if (this.reported.has(key)) return;
    this.reported.add(key);
    const reference = preset === undefined ? undefined : await this.reference(preset);
    if (reference !== undefined && lost.every((name) => !reference.includes(name))) return;
    this.options.warn(
      `tool-manager: Session ${agent.id ?? "<unknown>"} (preset ${JSON.stringify(preset ?? "<none>")}) lost ${lost.length} tool(s) — ${[...lost].sort().join(", ")} — with no mode switch. ` +
      `DSH caches a failed per-Agent registration for the life of the Agent, so reopen the Session (or restart DSH) to restore them.`,
    );
  }

  /**
   * Name the tools one Preset provides that a started Session does not hold.
   *
   * The previous tool set cannot answer this: a switch is observed after DSH's
   * failed install already settled, so the shortfall only shows against a
   * freshly composed reference Agent of the same Preset.
   */
  private async reportShortfall(agent: AgentLike, preset: string): Promise<void> {
    const names = toolNames(this.options.tools(), agent) ?? [];
    const reference = await this.reference(preset);
    if (reference === undefined) return;
    const missing = reference.filter(
      (name) => !names.includes(name) && !(this.options.explainedLoss?.(preset, name) ?? false),
    );
    if (missing.length === 0) return;
    const key = `${agent.id ?? "?"}|${preset}|short|${[...missing].sort().join(",")}`;
    if (this.reported.has(key)) return;
    this.reported.add(key);
    this.options.warn(
      `tool-manager: Session ${agent.id ?? "<unknown>"} (preset ${JSON.stringify(preset)}) is short of ${missing.length} tool(s) — ${[...missing].sort().join(", ")} — ` +
      `and it already started, so DSH keeps its preset fixed. Reopen the Session to restore them.`,
    );
  }

  /** The tool names a freshly composed Agent of one Preset holds. */
  private async reference(preset: string): Promise<readonly string[] | undefined> {
    const probe = this.options.probe;
    if (probe === undefined) return undefined;
    try {
      return (await probe(preset)).map((schema) => schema.name);
    } catch {
      return undefined;
    }
  }

  /**
   * Re-link one Agent through a transit Preset and back, so the intended
   * composition installs into an Agent whose competing registrations are gone.
   */
  private async recalibrate(job: Recalibration): Promise<void> {
    const { agent, target } = job;
    const agentId = agent.id ?? "<unknown>";
    const tools = this.options.tools();
    if (!isBlankSession(agent.session)) {
      // DSH keeps the preset of a started Session fixed, so the only honest
      // move left is to name what is missing and how to get it back.
      await this.reportShortfall(agent, target);
      return;
    }
    const transit = await this.chooseTransit(target);
    if (transit === undefined) {
      this.options.warn(
        `tool-manager: Session ${agentId} switched to preset ${JSON.stringify(target)} but no other usable preset exists to re-calibrate it through.`,
      );
      return;
    }
    const before = toolNames(tools, agent) ?? [];
    try {
      await this.options.presets.recompose(agent.ctx, transit);
      await this.settle();
      const composed = this.options.presets.composedPreset(agent.ctx);
      if (composed !== transit) {
        // A different switch landed while this Session was transiting: that
        // switch owns the Session now, so never force the preset this
        // re-calibration was started for. Re-calibrate for the newer one.
        if (composed !== undefined) {
          this.observations.set(agentId, { preset: composed, names: toolNames(tools, agent) ?? [] });
          if (composed !== target) this.pending.set(agentId, { agent, target: composed });
        }
        return;
      }
      await this.options.presets.recompose(agent.ctx, target);
      await this.settle();
    } catch (error) {
      await this.restore(agent, target);
      this.options.warn(
        `tool-manager: Session ${agentId} could not be re-calibrated through preset ${JSON.stringify(transit)}: ${errorMessage(error)}`,
      );
      return;
    }
    if (this.options.presets.composedPreset(agent.ctx) !== target) {
      await this.restore(agent, target);
      if (this.options.presets.composedPreset(agent.ctx) !== target) {
        this.options.warn(
          `tool-manager: Session ${agentId} is left on preset ${JSON.stringify(transit)} because the switch back to ${JSON.stringify(target)} did not commit; pick its mode again in the mode picker.`,
        );
        return;
      }
    }
    const after = toolNames(tools, agent) ?? [];
    this.observations.set(agentId, { preset: target, names: after });
    const restored = after.filter((name) => !before.includes(name));
    if (restored.length > 0) {
      const report = this.options.info ?? this.options.warn;
      report(
        `tool-manager: Session ${agentId} lost ${restored.length} tool(s) on the switch to preset ${JSON.stringify(target)} — ${[...restored].sort().join(", ")} — and re-calibration restored them.`,
      );
    }
  }

  /** The transit Preset: the one whose composition shares least with nothing. */
  private async chooseTransit(target: string): Promise<string | undefined> {
    let inventory: readonly PresetCompositionLike[];
    try {
      inventory = await this.options.presets.compositionInventory();
    } catch {
      return undefined;
    }
    const candidates = inventory.filter((item) => item.id !== target && item.broken === undefined);
    if (candidates.length === 0) return undefined;
    // The transit composes plugins, and any of them may own per-Agent
    // registrations of its own. The composition with the fewest rows is the
    // observable proxy for "installs the least", so it is the safest Agent to
    // hold while the intended composition takes its names back.
    return [...candidates].sort((left, right) => rowCount(left) - rowCount(right) || compareIds(left.id, right.id))[0]?.id;
  }

  /** Put one Agent back on its intended Preset after a failed leg. */
  private async restore(agent: AgentLike, target: string): Promise<void> {
    await this.options.presets.recompose(agent.ctx, target).catch(() => undefined);
    await this.settle();
  }

  private settle(): Promise<void> {
    return (this.options.settle ?? nextEventLoopTurn)();
  }
}

/**
 * Whether a Session is still blank enough for DSH to re-link it.
 *
 * `recompose()` itself has no lock — `agentPresets.select()` carries it — so
 * this mirrors that rule before touching a live Session: no turn started, no
 * inherited fork history to disturb.
 */
export function isBlankSession(session: AgentSessionLike | undefined): boolean {
  if (session === undefined) return false;
  if ((session.inheritedEventCount ?? 0) > 0) return false;
  if (session.seq > BLANK_SCAN_LIMIT) return false;
  if (typeof session.eventAt !== "function") return false;
  try {
    for (let seq = 1; seq <= session.seq; seq += 1) {
      const event = session.eventAt(seq);
      if (event !== undefined && STARTED_EVENT_TYPES.has(event.type)) return false;
    }
  } catch {
    // An unreadable Session is treated as started: never re-link blind.
    return false;
  }
  return true;
}

function toolNames(tools: ToolRuntimeLike | undefined, agent: AgentLike): readonly string[] | undefined {
  if (tools === undefined) return undefined;
  try {
    return tools.schemas(agent).map((schema) => schema.name);
  } catch {
    return undefined;
  }
}

function rowCount(composition: PresetCompositionLike): number {
  return composition.rows?.length ?? Number.MAX_SAFE_INTEGER;
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function disposedAgent(payload: unknown): AgentLike | undefined {
  if (payload === null || typeof payload !== "object") return undefined;
  const agent = (payload as { agent?: AgentLike }).agent;
  return agent !== undefined && typeof agent === "object" ? agent : undefined;
}

function firstEntry<V>(map: Map<string, V>): [string, V] | undefined {
  for (const entry of map) return entry;
  return undefined;
}

function nextEventLoopTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
