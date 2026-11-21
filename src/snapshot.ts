import type { AgentPresetsLike, ToolRuntimeLike } from "./dsh.js";
import { readPresetScope } from "./dsh.js";
import { policyFor, policyOrphans, resolveActiveGroups, resolveGroups } from "./policy.js";
import { estimateGroupTokens, estimateToolTokens, presetTokenStats } from "./stats.js";
import { measurePresetTokens, type TokenModel } from "./transport.js";
import {
  DISCOVERY_TOOL_NAME,
  PTC_TRANSPORT_NAME,
  type PresetCatalogView,
  type ToolManagerSettings,
  type ToolManagerSnapshot,
  type ToolSchemaView,
} from "./types.js";

export async function buildSnapshot(
  presets: AgentPresetsLike,
  tools: ToolRuntimeLike,
  settings: ToolManagerSettings,
  revision: number,
  configPath: string,
  observedSchemas?: (presetId: string) => readonly ToolSchemaView[],
): Promise<ToolManagerSnapshot> {
  const compositions = await presets.compositionInventory();
  const views: PresetCatalogView[] = [];

  for (const composition of compositions) {
    let schemas: ToolSchemaView[] = [];
    let broken = composition.broken;
    let model: TokenModel | undefined;
    if (!broken) {
      try {
        const read = await readPresetScope(presets, composition.id, (scope) => ({
          schemas: tools.schemas(scope),
          model: measurePresetTokens(tools, scope),
        }));
        model = read.model;
        const observed = observedSchemas?.(composition.id) ?? [];
        schemas = mergeSchemas(read.schemas, observed)
          .filter((schema) => schema.name !== DISCOVERY_TOOL_NAME && schema.name !== PTC_TRANSPORT_NAME)
          .map(projectSchema);
      } catch (error) {
        broken = error instanceof Error ? error.message : String(error);
      }
    }
    const policy = policyFor(settings, composition.id);
    const names = schemas.map((item) => item.name);
    const toolViews: ToolSchemaView[] = schemas.map((schema) => ({
      ...schema,
      tokens: model?.marginal(schema.name) ?? estimateToolTokens(schema),
    }));
    // What the listed tools cannot account for: the transport call and the tools
    // the editor hides, priced once so the rows and the total still reconcile.
    const constantTokens = model === undefined
      ? 0
      : Math.max(0, model.totalTokens - toolViews.reduce((sum, tool) => sum + (tool.tokens ?? 0), 0));
    const pricing = model === undefined ? undefined : { constantTokens };
    const tokenByGroup = new Map(
      resolveActiveGroups(policy, names).map((group) => [group.name, estimateGroupTokens(group, toolViews)]),
    );
    const groupViews = resolveGroups(policy, names).map((group) => ({
      ...group,
      tokens: tokenByGroup.get(group.name) ?? { schema: 0, catalog: 0, net: 0 },
    }));
    views.push({
      id: composition.id,
      ...(composition.name ? { name: composition.name } : {}),
      isDefault: composition.isDefault,
      ...(broken ? { broken } : {}),
      tools: toolViews,
      policy,
      groups: groupViews,
      orphans: policyOrphans(policy, names),
      ...(broken
        ? {}
        : {
            tokenStats: presetTokenStats(toolViews, policy, pricing),
            // Always named, so the page can say which ruler priced the numbers.
            transport: model?.transport ?? "native",
            ...(model === undefined ? {} : { constantTokens }),
          }),
    });
  }

  return {
    writable: true,
    revision,
    configPath,
    presets: views,
  };
}

export function mergeSchemas<T extends { name: string }>(
  standing: readonly T[],
  observed: readonly T[],
): T[] {
  const merged = new Map<string, T>();
  for (const schema of standing) merged.set(schema.name, schema);
  for (const schema of observed) merged.set(schema.name, schema);
  return [...merged.values()];
}

function projectSchema(schema: {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}): ToolSchemaView {
  return {
    name: schema.name,
    description: schema.description,
    parameters: schema.parameters,
  };
}
