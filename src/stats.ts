import { renderCatalogLine } from "./catalog.js";
import { matchesPattern, resolveActiveGroups } from "./policy.js";
import type {
  PresetTokenStats,
  PresetToolPolicy,
  ToolSchemaView,
  ToolTokenEstimate,
} from "./types.js";

export type { PresetTokenStats, ToolTokenEstimate } from "./types.js";

export interface ToolCatalogStats {
  totalTools: number;
  groupCount: number;
  ungroupedTools: number;
  onDemandTools: number;
  disabledTools: number;
}

type TokenSchema = Pick<ToolSchemaView, "name" | "description" | "parameters">;

/**
 * DSH's own estimator: 4 characters per token, measured over the exact tool
 * definition shape sent to the provider. Keep this in sync with
 * `@deepseek-ai/dsh-token-meter/estimate`.
 */
export function estimateToolTokens(schema: TokenSchema): number {
  return Math.ceil(JSON.stringify(toolPayload(schema)).length / 4);
}

/**
 * Estimate a whole `tools` array the way the host does: serialize the array
 * once and add the 4-token framing. An empty array costs nothing.
 */
export function estimateToolsTokens(tools: readonly TokenSchema[]): number {
  if (tools.length === 0) return 0;
  return Math.ceil(JSON.stringify(tools.map(toolPayload)).length / 4) + 4;
}

/**
 * Estimate one on-demand group. `schema` covers its active members (already
 * deduplicated first-match by `resolveActiveGroups`); `catalog` covers the
 * catalog line that remains in the prompt while the group is closed. A group
 * with no active members is not published in the catalog at all, so both
 * sides are zero rather than a negative saving.
 */
export function estimateGroupTokens(
  group: { name: string; description?: string; tools: readonly string[] },
  tools: readonly TokenSchema[],
): ToolTokenEstimate {
  if (group.tools.length === 0) return { schema: 0, catalog: 0, net: 0 };
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  let schema = 0;
  for (const name of group.tools) {
    const tool = byName.get(name);
    if (tool) schema += estimateToolTokens(tool);
  }
  const catalog = Math.ceil(renderCatalogLine({
    name: group.name,
    description: group.description ?? "",
    tools: [...group.tools],
  }).length / 4);
  return { schema, catalog, net: schema - catalog };
}

/** Preset-level summary used by the settings page and API consumers. */
export function presetTokenStats(
  tools: readonly TokenSchema[],
  policy: PresetToolPolicy,
): PresetTokenStats {
  const active = resolveActiveGroups(policy, tools.map((tool) => tool.name));
  const claimed = new Set<string>();
  for (const group of active) {
    for (const name of group.tools) claimed.add(name);
  }
  const disabled = new Set(policy.disabled);
  const alwaysOn = tools.filter((tool) => !disabled.has(tool.name) && !claimed.has(tool.name));
  const onDemand = tools.filter((tool) => claimed.has(tool.name));
  const disabledTools = tools.filter((tool) => disabled.has(tool.name));
  let onDemandTokens = 0;
  let onDemandSavings = 0;
  for (const group of active) {
    const estimate = estimateGroupTokens(group, tools);
    onDemandTokens += estimate.schema;
    onDemandSavings += estimate.net;
  }

  return {
    totalTokens: estimateToolsTokens(tools),
    alwaysOnTools: alwaysOn.length,
    alwaysOnTokens: estimateToolsTokens(alwaysOn),
    onDemandTools: onDemand.length,
    onDemandTokens,
    onDemandGroups: active.length,
    onDemandSavings,
    disabledTools: disabledTools.length,
    disabledTokens: estimateToolsTokens(disabledTools),
  };
}

export function toolCatalogStats(
  tools: readonly Pick<ToolSchemaView, "name">[],
  policy: PresetToolPolicy,
): ToolCatalogStats {
  const disabled = new Set(policy.disabled);
  const grouped = new Set<string>();
  for (const tool of tools) {
    if (policy.groups.some((group) => group.patterns.some((pattern) => matchesPattern(tool.name, pattern)))) {
      grouped.add(tool.name);
    }
  }

  let ungroupedTools = 0;
  let onDemandTools = 0;
  let disabledTools = 0;
  for (const tool of tools) {
    if (disabled.has(tool.name)) disabledTools += 1;
    else if (grouped.has(tool.name)) onDemandTools += 1;
    else ungroupedTools += 1;
  }

  return {
    totalTools: tools.length,
    groupCount: policy.groups.length,
    ungroupedTools,
    onDemandTools,
    disabledTools,
  };
}

function toolPayload(schema: TokenSchema): {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
} {
  return {
    name: schema.name,
    description: schema.description,
    parameters: schema.parameters,
  };
}
