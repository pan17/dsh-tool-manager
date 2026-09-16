export const DISCOVERY_TOOL_NAME = "tool_list";
export const PTC_TRANSPORT_NAME = "run_code";

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
}

export interface ResolvedGroupView {
  name: string;
  description?: string;
  patterns: string[];
  tools: string[];
}

export interface PresetOrphans {
  disabled: string[];
  emptyGroups: string[];
}

export interface PresetCatalogView {
  id: string;
  name?: string;
  trust: "system" | "user";
  isDefault: boolean;
  broken?: string;
  tools: ToolSchemaView[];
  policy: PresetToolPolicy;
  groups: ResolvedGroupView[];
  orphans: PresetOrphans;
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
