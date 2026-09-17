import type { AgentPresetsLike, ToolRuntimeLike } from "./dsh.js";
import { policyFor, policyOrphans, resolveGroups } from "./policy.js";
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
    if (!broken) {
      try {
        const key = await presets.standingKeyFor(composition.id);
        const standing = tools.schemas(key);
        const observed = observedSchemas?.(composition.id) ?? [];
        schemas = mergeSchemas(standing, observed)
          .filter((schema) => schema.name !== DISCOVERY_TOOL_NAME && schema.name !== PTC_TRANSPORT_NAME)
          .map(projectSchema);
      } catch (error) {
        broken = error instanceof Error ? error.message : String(error);
      }
    }
    const policy = policyFor(settings, composition.id);
    const names = schemas.map((item) => item.name);
    views.push({
      id: composition.id,
      ...(composition.name ? { name: composition.name } : {}),
      trust: composition.trust,
      isDefault: composition.isDefault,
      ...(broken ? { broken } : {}),
      tools: schemas,
      policy,
      groups: resolveGroups(policy, names),
      orphans: policyOrphans(policy, names),
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
