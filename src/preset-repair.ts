/**
 * Re-attach live Agents to the registry instance that replaced the one they
 * were composed against.
 *
 * DSH replaces the whole `agent-preset-registry` service when the Loader
 * restarts that node, and `dsh-scope` refuses to bind a scope key twice
 * (`bindScopeParent()` throws for a key that already has a parent). The
 * replacement instance therefore cannot `join()` an Agent composed by the
 * retired one: `composedPreset()` answers `undefined`, the preset's standing
 * composition was disposed with the old fiber, and the Session silently runs
 * on whatever the root bundle provides.
 *
 * The re-link capability does exist — it is the `ScopeParentBinding` handle
 * `bindScopeParent()` returned to the instance that bound the Agent, and its
 * `rebind()` re-links an already-bound key by design. That handle lives in the
 * registry's per-instance `bindings` WeakMap, and nothing public exposes the
 * Agent's scope key, but both are plain data this plugin can still reach:
 *
 * - the retired instance stays alive while a reference exists, and its
 *   `bindings` map still holds the handle it took for each live Agent;
 * - the key is the `Symbol("dsh.scope")`-tagged own property `createScope()`
 *   defined on the Agent's context, and a `WeakMap.get()` probe identifies it
 *   without depending on the symbol's identity.
 *
 * Replaying the registry's own `bind()`/`join()` bookkeeping against the live
 * instance then restores the Agent without a restart. Everything here is
 * feature-detected: a DSH that renames or privatizes these fields gets a
 * refused repair and one warning, never a throw.
 */
import type { AgentLike, AgentPresetsLike } from "./dsh.js";

/** A preset revision as the registry retains it. */
interface GenerationLike {
  /** Scope key every bound Agent's ancestry points at. */
  key?: unknown;
  /** How many bindings retain this revision. */
  users?: number;
  /** Whether the defining node unregistered it. */
  retired?: boolean;
  mount?: { presetId?: unknown };
}

/** The handle `bindScopeParent()` returned to the binding instance. */
interface ScopeParentBindingLike {
  rebind?: (next: unknown) => void;
}

/** One entry of the registry's `bindings` WeakMap. */
interface BindingLike {
  parent?: ScopeParentBindingLike;
  generation?: GenerationLike;
}

/** The bindings map, structurally: a `WeakMap` keyed by Agent scope key. */
interface BindingsLike {
  get(key: unknown): unknown;
  set?(key: unknown, value: unknown): unknown;
  delete?(key: unknown): unknown;
}

/** The registry internals this repair needs. */
interface RegistryLike {
  bindings?: BindingsLike;
  retain?: (id: string) => Promise<GenerationLike>;
  collect?: (generation: GenerationLike) => Promise<void>;
  composedPreset?: (agentCtx: unknown) => string | undefined;
  mount?: (agentCtx: unknown, presetId: string) => Promise<unknown>;
  owner?: { emit?: (event: string) => unknown };
}

/** One re-attach attempt, recorded so a live Host can explain itself. */
export interface RepairAttempt {
  at: number;
  id?: string;
  preset?: string;
  /** How it ended: `re-attached`, `same-instance`, or why it gave up. */
  outcome: string;
}

/** What one live Agent resolves, for `GET /tool-manager/api/repair`. */
export interface RepairAgentDiagnostics {
  id?: string;
  /** The preset the live instance reports for this Agent, if any. */
  composed?: string;
  /** The preset its Session log declares. */
  declared?: string;
  /** The preset this plugin last used for it. */
  preset?: string;
  /** How many tools its baseline snapshot holds. */
  baseline?: number;
}

/** What the repair can see right now, for `GET /tool-manager/api/repair`. */
export interface RepairDiagnostics {
  /** Whether a live registry instance is known. */
  live: boolean;
  /** Whether the instance it replaced is still reachable for its handles. */
  retired: boolean;
  /** Whether the live instance exposes the internals the repair needs. */
  liveCapable: boolean;
  /** Whether the retired instance still exposes its bindings map. */
  retiredCapable: boolean;
  /** Why a repair was refused, newest last; empty when nothing was refused. */
  refusals: readonly string[];
  /** The most recent re-attach attempts, newest last. */
  attempts: readonly RepairAttempt[];
}

export interface PresetRepairOptions {
  /** Report a refusal or failure once per reason, so a broken host stays quiet. */
  warn: (message: string) => void;
}

/**
 * The registry instances seen so far, kept on the global object.
 *
 * This plugin declares `agentPresets` in `inject`, so DSH restarts it whenever
 * that service is replaced — which is exactly the event the repair exists for.
 * Instance-local state would therefore be dropped at the worst moment, and the
 * one reference that can still re-link a live Agent (the retired instance, and
 * the `ScopeParentBinding` handles inside it) would be collected. The history
 * survives the restart because the module, the global and the retired instance
 * all outlive the fiber.
 */
interface RegistryHistory {
  live?: AgentPresetsLike;
  retired?: AgentPresetsLike;
}

const HISTORY_KEY = Symbol.for("dsh-tool-manager.preset-registry-history");

/** How many re-attach attempts to remember for diagnostics. */
const ATTEMPT_LIMIT = 20;

function registryHistory(): RegistryHistory {
  const holder = globalThis as unknown as Record<symbol, RegistryHistory | undefined>;
  holder[HISTORY_KEY] ??= {};
  return holder[HISTORY_KEY];
}

/** The last registry instance this plugin saw, plus the one it replaced. */
export class PresetBindingRepair {
  private readonly reported = new Set<string>();
  /** Refusals in the order they happened, for diagnostics(). */
  private readonly refused: string[] = [];
  /** Recent re-attach attempts, newest last, for diagnostics(). */
  private readonly attempts: RepairAttempt[] = [];

  constructor(private readonly options: PresetRepairOptions) {}

  /** Remember the instance DSH publishes, keeping the one it replaced. */
  observe(live: AgentPresetsLike | undefined): void {
    if (live === undefined) return;
    const history = registryHistory();
    if (history.live === live) return;
    history.retired = history.live;
    history.live = live;
  }

  /**
   * The preset an Agent was last bound to, read from the binding itself.
   *
   * The Session projection is the authoritative answer for what an Agent
   * *should* run, but it belongs to one registry instance and is rebuilt lazily;
   * the binding that is about to be repaired still names the composition the
   * Agent actually lost, which is enough to restore it.
   * @param agent - the Agent to inspect.
   * @returns the preset id, when any instance still holds a binding for it.
   */
  boundPreset(agent: AgentLike): string | undefined {
    const history = registryHistory();
    for (const candidate of [history.retired, history.live] as RegistryLike[]) {
      const bindings = candidate?.bindings;
      if (bindings === undefined || typeof bindings.get !== "function") continue;
      const key = scopeKeyOf(agent.ctx, bindings);
      if (key === undefined) continue;
      const presetId = (bindings.get(key) as BindingLike | undefined)?.generation?.mount?.presetId;
      if (typeof presetId === "string") return presetId;
    }
    return undefined;
  }

  /** Record one attempt so a live Host can explain what it decided. */
  private note(agent: AgentLike, presetId: string | undefined, outcome: string): void {
    this.attempts.push({
      at: Date.now(),
      ...(agent.id === undefined ? {} : { id: agent.id }),
      ...(presetId === undefined ? {} : { preset: presetId }),
      outcome,
    });
    if (this.attempts.length > ATTEMPT_LIMIT) this.attempts.splice(0, this.attempts.length - ATTEMPT_LIMIT);
  }

  /**
   * Move one Agent's preset ancestry onto the live instance's revision.
   *
   * Mirrors `mount()`: `retain()` leases the revision, the re-linked binding
   * takes its own reference, and the lease is released afterwards. A revision
   * the live instance does not have throws (`agent-preset/not-found`,
   * `agent-preset/invalid`) and the caller decides what to report.
   * @param agent - the Agent to re-attach.
   * @param wanted - the preset its Session runs; read from the lost binding when
   *   the Session projection is not available on the replacement instance.
   * @returns whether the Agent now resolves that preset on the live instance.
   */
  async relink(agent: AgentLike, wanted: string | undefined): Promise<boolean> {
    const history = registryHistory();
    const live = history.live as RegistryLike | undefined;
    const retired = history.retired as RegistryLike | undefined;
    const presetId = wanted ?? this.boundPreset(agent);
    if (live === undefined) {
      this.note(agent, presetId, "no-live-instance");
      return false;
    }
    if (presetId === undefined) {
      this.note(agent, presetId, "no-preset-id");
      return false;
    }
    // Case A: the instance is the same, but the definition was re-registered
    // (`dsh-agent-preset` restarts whenever `agentPresets` is replaced). The
    // Agent still holds a binding here, so the registry's own bind() path can
    // rebind it; no handle from a dead instance is needed.
    const sameInstance = live.bindings !== undefined
      && scopeKeyOf(agent.ctx, live.bindings) !== undefined;
    if (sameInstance) {
      this.note(agent, presetId, "same-instance");
      return this.remount(live, agent, presetId);
    }
    // Case B: the instance was replaced. Only the retired instance still holds
    // the `ScopeParentBinding` this Agent needs, so it has to be reachable.
    if (retired === undefined || live === retired) {
      this.note(agent, presetId, "no-retired-instance");
      return false;
    }
    if (typeof live.retain !== "function" || typeof live.collect !== "function") {
      return this.refuse("no-retain", "the registry exposes no retain()/collect()");
    }
    const bindings = retired.bindings;
    if (bindings === undefined || typeof bindings.get !== "function") {
      return this.refuse("no-bindings", "the replaced registry exposes no bindings map");
    }
    const key = scopeKeyOf(agent.ctx, bindings);
    if (key === undefined) {
      return this.refuse(
        `no-key:${agent.id ?? "?"}`,
        `Agent ${agent.id ?? "<unknown>"} has no binding on the replaced registry instance`,
      );
    }
    const binding = bindings.get(key) as BindingLike | undefined;
    const parent = binding?.parent;
    if (typeof parent?.rebind !== "function") {
      return this.refuse(
        `no-rebind:${agent.id ?? "?"}`,
        `Agent ${agent.id ?? "<unknown>"}: the retained binding exposes no rebind()`,
      );
    }

    const generation = await live.retain(presetId);
    try {
      // The re-linked binding holds its own reference, exactly as join() takes one.
      generation.users = (generation.users ?? 0) + 1;
      try {
        parent.rebind(generation.key);
      } catch (error) {
        generation.users -= 1;
        throw error;
      }
      this.adopt(live, bindings, agent, key, parent, generation);
      this.release(live, binding?.generation);
      emitToolsChange(live);
      const composed = typeof live.composedPreset === "function"
        ? live.composedPreset(agent.ctx)
        : generation.mount?.presetId;
      this.note(agent, presetId, composed === presetId ? "re-attached" : `composed=${String(composed)}`);
      return composed === presetId;
    } finally {
      // Drop the lease retain() took; the binding keeps its own reference.
      generation.users = (generation.users ?? 1) - 1;
      await live.collect(generation);
    }
  }

  /**
   * Re-mount an Agent on the instance that already knows it.
   *
   * `mount()` is the registry's own entry point: it leases the current revision
   * of `presetId`, and `bind()` sees the existing binding and calls `rebind()`
   * instead of `bindScopeParent()`. That is precisely the path a definition
   * re-registration needs, so the plugin never has to reimplement it.
   * @param live - the registry instance DSH currently publishes.
   * @param agent - the Agent to re-attach.
   * @param presetId - the preset its Session runs.
   * @returns whether the Agent now resolves that preset.
   */
  private async remount(live: RegistryLike, agent: AgentLike, presetId: string): Promise<boolean> {
    if (typeof live.mount !== "function") {
      return this.refuse("no-mount", "the registry exposes no mount() to re-attach a known Agent");
    }
    await live.mount(agent.ctx, presetId);
    const composed = typeof live.composedPreset === "function"
      ? live.composedPreset(agent.ctx)
      : presetId;
    return composed === presetId;
  }

  /** Publish the re-linked binding and release the revision when the Agent dies. */
  private adopt(
    live: RegistryLike,
    bindings: BindingsLike,
    agent: AgentLike,
    key: unknown,
    parent: ScopeParentBindingLike,
    generation: GenerationLike,
  ): void {
    const next: BindingLike = { parent, generation };
    // Keep both maps consistent: future bind() calls on either instance rebind
    // instead of trying to join a key that already has a parent.
    bindings.set?.(key, next);
    live.bindings?.set?.(key, next);
    const release = (): void => {
      live.bindings?.delete?.(key);
      bindings.delete?.(key);
      generation.users = (generation.users ?? 1) - 1;
      void live.collect?.(generation);
    };
    // The registry wires the same release through the Agent's own effect; do it
    // here so the revision cannot outlive the Agent that joined it.
    try {
      agent.ctx.effect?.(() => release, "tool-manager.preset-relink");
    } catch {
      // A refused effect only costs a retained revision, never correctness.
    }
  }

  /** Drop the retired instance's reference to the revision it used to hold. */
  private release(live: RegistryLike, generation: GenerationLike | undefined): void {
    if (generation === undefined || typeof generation.users !== "number") return;
    generation.users -= 1;
    void live.collect?.(generation);
  }

  /** Snapshot what the repair can see, so a live Host can be diagnosed. */
  diagnostics(): RepairDiagnostics {
    const history = registryHistory();
    const live = history.live as RegistryLike | undefined;
    const retired = history.retired as RegistryLike | undefined;
    return {
      live: live !== undefined,
      retired: retired !== undefined && retired !== live,
      liveCapable: typeof live?.retain === "function" && typeof live?.collect === "function",
      retiredCapable: retired?.bindings !== undefined && typeof retired.bindings.get === "function",
      refusals: [...this.refused],
      attempts: [...this.attempts],
    };
  }

  private refuse(key: string, reason: string): false {
    if (!this.reported.has(key)) {
      this.reported.add(key);
      this.refused.push(`${key}: ${reason}`);
      this.options.warn(`tool-manager: cannot re-attach a Session to the reloaded agent preset registry: ${reason}.`);
    }
    return false;
  }
}

/**
 * Read the scope key `createScope()` tagged onto a context.
 *
 * The tag is a symbol-keyed property whose value is the key itself. It is not
 * necessarily an own property: `Context.extend()` returns a shadowed object when
 * the context has a use-site shadow, and the tag then lives on the prototype.
 * Walking the whole chain and probing each symbol value against the retired
 * instance's bindings map finds it without hardcoding the symbol's identity.
 */
function scopeKeyOf(ctx: unknown, bindings: BindingsLike): unknown {
  if (ctx === null || typeof ctx !== "object") return undefined;
  for (let cursor: object | null = ctx as object; cursor !== null; cursor = Object.getPrototypeOf(cursor) as object | null) {
    let keys: PropertyKey[];
    try {
      keys = Reflect.ownKeys(cursor);
    } catch {
      return undefined;
    }
    for (const symbol of keys) {
      if (typeof symbol !== "symbol") continue;
      let value: unknown;
      try {
        value = (ctx as Record<symbol, unknown>)[symbol];
      } catch {
        continue;
      }
      if (value === null || value === undefined) continue;
      if (typeof value !== "object" && typeof value !== "function") continue;
      let bound: unknown;
      try {
        bound = bindings.get(value);
      } catch {
        continue;
      }
      if (bound !== undefined) return value;
    }
  }
  return undefined;
}

/** Emit the invalidation the registry raises after any composition change. */
function emitToolsChange(live: RegistryLike): void {
  try {
    live.owner?.emit?.("tools/change");
  } catch {
    // Observers are best-effort; the next step resolves tools anyway.
  }
}
