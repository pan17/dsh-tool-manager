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
