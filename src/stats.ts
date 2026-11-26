import { renderCatalogLine } from "./catalog.js";
import { groupForTool, matchesPattern, resolveActiveGroups } from "./policy.js";
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
  /** Resident tools that are not part of an on-demand group; includes `always` groups. */
  ungroupedTools: number;
  onDemandTools: number;
  disabledTools: number;
}

type TokenSchema = Pick<ToolSchemaView, "name" | "description" | "parameters"> & {
  /** Resident tokens supplied by a snapshot's transport-aware measurement. */
  tokens?: number;
};

/** How the written transcript prices a Preset: the JSON projection, or a rendered SDK. */
export interface TokenPricing {
  /** Tokens no toggle can remove; see `PresetCatalogView.constantTokens`. */
  constantTokens: number;
}

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
  group: {
    name: string;
    description?: string;
    tools: readonly string[];
    loading?: "always" | "ondemand" | "off";
  },
  tools: readonly TokenSchema[],
): ToolTokenEstimate {
  if (group.tools.length === 0 || group.loading === "off") return { schema: 0, catalog: 0, net: 0 };
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  let schema = 0;
  for (const name of group.tools) {
    const tool = byName.get(name);
    if (tool) schema += residentTokens(tool);
  }
  // `always` groups have no catalog line: their schemas are simply resident.
  if (group.loading === "always") return { schema, catalog: 0, net: schema };
  const catalog = Math.ceil(renderCatalogLine({
    name: group.name,
    description: group.description ?? "",
    tools: [...group.tools],
  }).length / 4);
  return { schema, catalog, net: schema - catalog };
}

/**
 * One tool's resident cost: the transport's marginal measurement when the
 * snapshot carries one, else the Host's JSON projection.
 */
function residentTokens(tool: TokenSchema): number {
  return typeof tool.tokens === "number" ? tool.tokens : estimateToolTokens(tool);
}

/**
 * Preset-level summary used by the settings page and API consumers.
 *
 * @param tools - the Preset's visible tools, in catalog order.
 * @param policy - its disabled tools and on-demand groups.
 * @param pricing - present when the transport prices rendered text: sums then
 * follow the per-tool marginals and add the fixed floor, because an array-wide
 * JSON projection cannot describe a document rendered as one string.
 */
export function presetTokenStats(
  tools: readonly TokenSchema[],
  policy: PresetToolPolicy,
  pricing?: TokenPricing,
): PresetTokenStats {
  const names = tools.map((tool) => tool.name);
  const active = resolveActiveGroups(policy, names);
  const onDemandGroups = active.filter((group) => group.loading === "ondemand");
  const presetDisabled = new Set(policy.disabled);
  const alwaysOn: TokenSchema[] = [];
  const onDemand: TokenSchema[] = [];
  const disabled: TokenSchema[] = [];
  for (const tool of tools) {
    const owner = groupForTool(policy, names, tool.name);
    if (
      presetDisabled.has(tool.name)
      || owner?.loading === "off"
      || owner?.disabled.includes(tool.name)
    ) {
      disabled.push(tool);
    } else if (owner?.loading === "always") {
      alwaysOn.push(tool);
    } else if (owner !== undefined) {
      onDemand.push(tool);
    } else {
      alwaysOn.push(tool);
    }
  }
  let onDemandTokens = 0;
  let onDemandSavings = 0;
  for (const group of onDemandGroups) {
    const estimate = estimateGroupTokens(group, tools);
    onDemandTokens += estimate.schema;
    onDemandSavings += estimate.net;
  }

  const bucketTokens = (list: readonly TokenSchema[]): number => pricing === undefined
    ? estimateToolsTokens(list)
    : list.reduce((sum, tool) => sum + residentTokens(tool), 0);

  return {
    totalTokens: pricing === undefined ? estimateToolsTokens(tools) : bucketTokens(tools) + pricing.constantTokens,
    alwaysOnTools: alwaysOn.length,
    alwaysOnTokens: bucketTokens(alwaysOn),
    onDemandTools: onDemand.length,
    onDemandTokens,
    onDemandGroups: onDemandGroups.length,
    onDemandSavings,
    disabledTools: disabled.length,
    disabledTokens: bucketTokens(disabled),
  };
}

export function toolCatalogStats(
  tools: readonly Pick<ToolSchemaView, "name">[],
  policy: PresetToolPolicy,
): ToolCatalogStats {
  const disabled = new Set(policy.disabled);
  const groups = policy.groups.map((group) => ({
    group,
    loading: group.loading === "always" || group.loading === "off" ? group.loading : "ondemand",
    disabled: new Set(group.disabled ?? []),
  }));

  let ungroupedTools = 0;
  let onDemandTools = 0;
  let disabledTools = 0;
  for (const tool of tools) {
    if (disabled.has(tool.name)) {
      disabledTools += 1;
      continue;
    }
    const owner = groups.find(({ group }) => group.patterns.some((pattern) => matchesPattern(tool.name, pattern)));
    if (!owner) {
      ungroupedTools += 1;
      continue;
    }
    if (owner.loading === "off" || owner.disabled.has(tool.name)) disabledTools += 1;
    else if (owner.loading === "ondemand") onDemandTools += 1;
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
