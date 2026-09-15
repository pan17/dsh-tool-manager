import type { AgentPresetsLike, SettingsProviderLike, ToolRuntimeLike } from "./dsh.js";
import { policyFor, policyOrphans, resolveGroups } from "./policy.js";
import {
  DISCOVERY_TOOL_NAME,
  PTC_TRANSPORT_NAME,
  SETTINGS_NAMESPACE,
  type PresetCatalogView,
  type ToolManagerSettings,
  type ToolManagerSnapshot,
  type ToolSchemaView,
} from "./types.js";

export async function buildSnapshot(
  presets: AgentPresetsLike,
  tools: ToolRuntimeLike,
  settingsProvider: SettingsProviderLike,
  settings: ToolManagerSettings,
): Promise<ToolManagerSnapshot> {
  const compositions = await presets.compositionInventory();
  const descriptor = settingsProvider
    .describe({ redactSecrets: true })
    .find((item) => String(item.ns) === SETTINGS_NAMESPACE);
  const views: PresetCatalogView[] = [];

  for (const composition of compositions) {
    let schemas: ToolSchemaView[] = [];
    let broken = composition.broken;
    if (!broken) {
      try {
        const key = await presets.standingKeyFor(composition.id);
        schemas = tools.schemas(key)
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
    writable: settingsProvider.writable,
    revision: descriptor?.revision ?? 0,
    presets: views,
  };
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
