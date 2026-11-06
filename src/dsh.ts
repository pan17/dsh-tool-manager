/** Structural DSH faces used by this plugin. No @deepseek-ai runtime imports. */

export interface ContextLike {
  get<T = unknown>(name: string): T | undefined;
  on(event: string, listener: (...args: unknown[]) => unknown): unknown;
  inject?(deps: string[], callback: (ctx: ContextLike) => unknown): unknown;
  effect?(execute: () => unknown, label?: string): unknown;
}

export interface SessionEventLike {
  type: string;
  seq: number;
  data: unknown;
}

export interface AgentSessionLike {
  seq: number;
  /** Fork-inherited prefix; restored Sessions keep the original fork boundary. */
  inheritedEventCount?: number;
  surface?: { nodes?: readonly number[] };
  eventAt(seq: number): SessionEventLike | undefined;
}

export interface AgentLike {
  /** Shared Agent/Session identity. */
  id?: string;
  ctx: ContextLike;
  session?: AgentSessionLike;
}

export interface ToolSchemaLike {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolRuntimeLike {
  schemas(scope?: unknown): ToolSchemaLike[];
  register(definition: unknown): () => void;
  restrict(filter: { deny: string[] }): () => void;
  guard?(guard: (execution: { name: string }) => string | undefined): () => void;
}

export interface ModelSelectionLike {
  provider: string;
  model: string;
  reasoningEffort?: string;
}

export interface AgentDefaultModelLike {
  currentSelection(): ModelSelectionLike;
}

export type StreamChunkLike =
  | { type: "block-start"; index: number; blockType: string }
  | { type: "text-delta"; index: number; text: string }
  | { type: "reasoning-delta"; index: number; text: string }
  | { type: "tool-call-delta"; index: number; name?: string; argumentsDelta: string }
  | { type: "block-end"; index: number; block: { type: string; text?: string } }
  | { type: "usage"; usage: unknown }
  | { type: "finish"; reason: { kind: string; failure?: { message?: string } } };

export interface LlmRuntimeLike {
  stream(options: {
    provider: string;
    model: string;
    reasoningEffort?: string;
    messages: unknown[];
    system?: string;
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
  }): AsyncIterable<StreamChunkLike>;
}

export interface PresetScopeLease {
  readonly key: unknown;
  [Symbol.asyncDispose](): Promise<void>;
}

export interface AgentPresetsLike {
  composedPreset(agentCtx: ContextLike): string | undefined;
  /**
   * The preset one Session runs, read from the Session log rather than from
   * this instance's Agent bindings.
   *
   * A registry instance binds an Agent's scope key when it composes that
   * Agent; a replacement instance has no binding for Agents composed by the
   * retired one, and `dsh-scope` forbids re-linking a key that already has a
   * parent. The Session log still records the preset the Session runs, which is
   * the only durable source once the binding is gone. Absent on older DSH.
   */
  presetForSession?(session: AgentSessionLike | undefined): string | null | undefined;
  compositionInventory(): Promise<PresetCompositionLike[]>;
  /**
   * Lease the standing preset revision so its registrations can be read
   * without creating an Agent. Absent id resolves the configured default.
   * Dispose the lease after the scoped read completes.
   */
  acquireScope(id?: string): Promise<PresetScopeLease>;
  mount(agentCtx: ContextLike, id: string): Promise<unknown>;
  recompose(agentCtx: ContextLike, id: string): Promise<unknown>;
}

/**
 * The live `agentPresets` service, or a resolver that reads it on every use.
 *
 * DSH re-applies a plugin node on its own Fiber to reload the node's config,
 * and that constructs a NEW service instance: the registry's `definitions` map
 * belongs to the instance, so every preset re-registers into the new one while
 * the retired instance keeps the empty map its unregister disposers left.
 * A consumer that captured the instance at load therefore answers from a
 * retired roster for the rest of the Host run — an empty Preset list on the
 * settings page, and `composedPreset()` returning `undefined` for every Agent.
 * Long-lived consumers take a resolver instead and keep no instance.
 */
export type AgentPresetsSource = AgentPresetsLike | (() => AgentPresetsLike | undefined);

/**
 * Read one Preset-service source: a fixed instance, or the live one.
 * @param source - the instance or resolver a consumer was given.
 * @returns the service, or `undefined` while DSH has none provided.
 */
export function resolvePresets(source: AgentPresetsSource): AgentPresetsLike | undefined {
  return typeof source === "function" ? source() : source;
}

/**
 * The preset a Session runs, according to the Session log.
 *
 * Answers even when the live registry holds no binding for the Agent: the log
 * records the preset the Session started in (and every selection since), while
 * bindings belong to the instance that composed the Agent.
 * @param presets - the live registry.
 * @param agent - the Agent whose Session to read.
 * @returns the preset id, or `undefined` when the Host cannot tell.
 */
export function presetForAgent(presets: AgentPresetsLike, agent: AgentLike): string | undefined {
  const read = presets.presetForSession;
  if (typeof read !== "function") return undefined;
  try {
    const declared = read.call(presets, agent.session);
    return typeof declared === "string" && declared !== "" ? declared : undefined;
  } catch {
    return undefined;
  }
}

export interface PresetCompositionRowLike {
  entryId?: string | null;
  moduleName?: string;
  enabled?: unknown;
  fiberState?: unknown;
}

export interface PresetCompositionLike {
  id: string;
  name?: string;
  isDefault: boolean;
  broken?: string;
  /** Mounted composition rows; the re-calibration transit is picked by row count. */
  rows?: readonly PresetCompositionRowLike[];
}

export interface AgentsLike {
  list(): AgentLike[];
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

/** Read one preset's standing schemas and always release the revision lease. */
export async function schemasForPreset(
  presets: AgentPresetsLike,
  tools: ToolRuntimeLike,
  id?: string,
): Promise<ToolSchemaLike[]> {
  const lease = await presets.acquireScope(id);
  try {
    return tools.schemas(lease.key);
  } finally {
    await lease[Symbol.asyncDispose]();
  }
}
