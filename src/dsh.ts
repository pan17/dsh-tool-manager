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

export interface PresetCompositionRowLike {
  entryId?: string | null;
  moduleName?: string;
  enabled?: unknown;
  fiberState?: unknown;
}

export interface PresetCompositionLike {
  id: string;
  name?: string;
  /** Present on older DSH inventories; 0.1.7 no longer reports trust. */
  trust?: "system" | "user";
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
