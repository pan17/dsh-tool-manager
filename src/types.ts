export const DISCOVERY_TOOL_NAME = "tool_list";
export const PTC_TRANSPORT_NAME = "run_code";
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
}

export interface ToolManagerSettings {
  presets: PresetPolicyMap;
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
