export const DISCOVERY_TOOL_NAME = "tool_list";
export const PTC_TRANSPORT_NAME = "run_code";
/** MCP-style discovery tool: search the hidden pool without changing the declaration set. */
export const MCP_FIND_TOOL_NAME = "tool_find";
/** One durable internal Session shared by every cold-Preset schema probe. */
export const TOOL_MANAGER_PROBE_SESSION_ID = "tool-manager-probe-internal-v1";

export type PresetPolicyMap = Record<string, PresetToolPolicy>;

export interface ToolGroupPolicy {
  /** Display name the model uses to open this group. */
  name: string;
  /** Optional description of what the group is for. */
  description?: string;
  /** Exact tool names and optional `*` wildcard patterns from older configs. */
  patterns: string[];
}

export interface PresetToolPolicy {
  /** Exact tool names hidden for every session on this preset. */
  disabled: string[];
  /** On-demand groups hidden until exposed with tool_list. */
  groups: ToolGroupPolicy[];
  /** Tool-loading mode; absent means the historical "groups" mode. */
  mode?: "groups" | "mcp";
  /**
   * On-demand groups kept open after a completed compaction.
   *
   * Absent keeps every group this Session ever opened, which is the historical
   * behaviour. `0` closes them all at each completed compaction; `N` keeps the
   * N most recently touched ones. Recency is scoped to the current compaction
   * interval: groups only survive when opened, reopened or used since the
   * previous compaction, so a group that merely stayed open is closed at the
   * next one. Only the default (groups) mode has an open state, so mcp mode
   * ignores it.
   */
  keepAfterCompaction?: number;
}

/** One provider route, model id, and optional adapter-owned reasoning effort. */
export interface ModelChoice {
  provider: string;
  model: string;
  /** Adapter-owned effort; absent follows the model's own default. */
  reasoningEffort?: string;
}

/**
 * Model both AI generation tasks run instead of the deployment default.
 *
 * Auto-naming and auto-grouping only classify tools and print JSON, so a fast
 * model is usually enough even when the default model is a slow reasoning one.
 * `provider` + `model` pin an exact route; leaving both out keeps the plugin on
 * whatever the deployment default model is, which is how a reasoning level can
 * be chosen without pinning a model.
 */
export interface GenerationSettings {
  provider?: string;
  model?: string;
  /** Adapter-owned effort; absent follows the model's own default. */
  reasoningEffort?: string;
}

export interface ToolManagerSettings {
  presets: PresetPolicyMap;
  /** Shared generation model; absent follows the deployment default model. */
  generation?: GenerationSettings;
}

/** One adapter-owned reasoning effort offered to the settings page. */
export interface ModelEffortView {
  id: string;
  name: string;
  description?: string;
}

/** Selectable reasoning metadata for one exact provider/model route. */
export interface ModelReasoningView {
  efforts: ModelEffortView[];
  defaultEffort?: string;
}

/** One model the settings page can offer as a generation model. */
export interface ModelCatalogEntryView {
  id: string;
  name: string;
  description?: string;
  reasoning?: ModelReasoningView;
}

/** One provider route and the models it currently advertises. */
export interface ModelCatalogGroupView {
  id: string;
  name: string;
  models: ModelCatalogEntryView[];
}

/** One provider whose model catalog could not be read. */
export interface ModelCatalogFailureView {
  id: string;
  name: string;
  message: string;
}

/** Everything the settings page needs to offer a generation model. */
export interface ModelCatalogView {
  groups: ModelCatalogGroupView[];
  failures: ModelCatalogFailureView[];
}

export interface ToolSchemaView {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** Estimated resident tokens for this tool's schema, when supplied by a snapshot. */
  tokens?: number;
}

/**
 * How a preset's tools reach the model: `native` sends JSON tool schemas in the
 * request's `tools` array, `ptc` sends one `run_code` tool plus a rendered SDK
 * document in the system prompt. The two are measured on different text.
 */
export type ToolTokenTransport = "native" | "ptc";

export interface ToolTokenEstimate {
  /** Sum of the group's active member tool schemas. */
  schema: number;
  /** The catalog line still injected while the group is closed. */
  catalog: number;
  /** Token saved per model request after the group is collapsed. */
  net: number;
}

export interface PresetTokenStats {
  totalTokens: number;
  alwaysOnTools: number;
  alwaysOnTokens: number;
  onDemandTools: number;
  onDemandTokens: number;
  onDemandGroups: number;
  onDemandSavings: number;
  disabledTools: number;
  disabledTokens: number;
}

export interface ResolvedGroupView {
  name: string;
  description?: string;
  patterns: string[];
  tools: string[];
  /** Present only for groups with active members. */
  tokens?: ToolTokenEstimate;
}

export interface PresetOrphans {
  disabled: string[];
  emptyGroups: string[];
}

export interface PresetCatalogView {
  id: string;
  name?: string;
  isDefault: boolean;
  broken?: string;
  tools: ToolSchemaView[];
  policy: PresetToolPolicy;
  groups: ResolvedGroupView[];
  orphans: PresetOrphans;
  tokenStats?: PresetTokenStats;
  /** Where `tokens` comes from; absent on a Preset priced by the JSON projection. */
  transport?: ToolTokenTransport;
  /**
   * Tokens every request pays whatever the tools are set to: the transport call,
   * the executor's instructions, and tools the editor never lists. Present only
   * for a transport that renders text as a whole (PTC).
   */
  constantTokens?: number;
}

export interface ToolManagerSnapshot {
  writable: boolean;
  revision: number;
  configPath: string;
  presets: PresetCatalogView[];
  /** Stored generation model; absent follows `defaultSelection`. */
  generation?: GenerationSettings;
  /** The deployment default model, named so the page can say what "follow" means. */
  defaultSelection?: ModelChoice;
}

export type ToolListGroupView = {
  name: string;
  description?: string;
  exposed: boolean;
};

export type ToolListResult = {
  name: string;
  description?: string;
  tools: string[];
};
