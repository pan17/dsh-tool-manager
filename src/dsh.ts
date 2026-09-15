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
  surface?: { nodes?: readonly number[] };
  eventAt(seq: number): SessionEventLike | undefined;
}

export interface AgentLike {
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
}

export interface AgentPresetsLike {
  composedPreset(agentCtx: ContextLike): string | undefined;
  compositionInventory(): Promise<PresetCompositionLike[]>;
  standingKeyFor(id: string): Promise<unknown>;
}

export interface PresetCompositionLike {
  id: string;
  name?: string;
  trust: "system" | "user";
  isDefault: boolean;
  broken?: string;
}

export interface SettingsDescriptorLike {
  ns: string;
  revision: number;
}

export interface SettingsScopeLike {
  get(): unknown;
  watch(callback: (next: unknown, prev: unknown) => void | Promise<void>): () => void;
}

export interface SettingsProviderLike {
  writable: boolean;
  register(ns: string, schema: unknown, options?: unknown): SettingsScopeLike;
  describe(options?: { redactSecrets?: boolean }): SettingsDescriptorLike[];
  replace(ns: string, section: object, expectedRevision?: number): Promise<void>;
}

export interface AgentsLike {
  list(): AgentLike[];
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}
