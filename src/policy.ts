import {
  DISCOVERY_TOOL_NAME,
  MCP_FIND_TOOL_NAME,
  PTC_TRANSPORT_NAME,
  type GenerationSettings,
  type GroupLoading,
  type PresetOrphans,
  type PresetToolPolicy,
  type ResolvedGroupView,
  type ToolGroupPolicy,
  type ToolListGroupView,
  type ToolManagerSettings,
} from "./types.js";

export const EMPTY_PRESET_POLICY: PresetToolPolicy = Object.freeze({
  disabled: [],
  groups: [],
});

export function normalizeSettings(value: unknown): ToolManagerSettings {
  const record = asRecord(value);
  const inputPresets = asRecord(record?.presets);
  const presets: ToolManagerSettings["presets"] = {};

  for (const [presetId, rawPolicy] of Object.entries(inputPresets ?? {})) {
    if (!presetId.trim()) continue;
    presets[presetId] = normalizePresetPolicy(rawPolicy);
  }

  const generation = normalizeGenerationSettings(record?.generation);
  return {
    presets,
    ...(generation === undefined ? {} : { generation }),
  };
}

/**
 * The settings one save writes.
 *
 * A page loaded before the generation setting existed sends only `presets`,
 * and its missing key means "not edited" rather than "clear it": the stored
 * choice is carried over. The current page always sends the key, using an
 * explicit `null` to follow the default model again.
 * @param value - the request's `settings` payload.
 * @param current - what the config store holds right now.
 * @returns the complete settings to persist.
 */
export function settingsForSave(value: unknown, current: ToolManagerSettings): ToolManagerSettings {
  const record = asRecord(value);
  const next = normalizeSettings(record);
  if (!record || !Object.prototype.hasOwnProperty.call(record, "generation")) {
    const stored = current.generation;
    if (stored) next.generation = { ...stored };
  }
  return next;
}

/**
 * The shared AI generation model, or `undefined` to let the plugin choose.
 *
 * A complete route (`provider` + `model`) pins both. Without one, only the
 * reasoning effort survives: the plugin keeps running whatever the deployment
 * default model is and just overrides how hard it thinks, which is exactly what
 * picking a level in the page's model row does before a model is chosen.
 */
export function normalizeGenerationSettings(value: unknown): GenerationSettings | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const provider = typeof record.provider === "string" ? record.provider.trim() : "";
  const model = typeof record.model === "string" ? record.model.trim() : "";
  const reasoningEffort = typeof record.reasoningEffort === "string" ? record.reasoningEffort.trim() : "";
  if (provider && model) {
    return {
      provider,
      model,
      ...(reasoningEffort ? { reasoningEffort } : {}),
    };
  }
  return reasoningEffort ? { reasoningEffort } : undefined;
}

export function normalizePresetPolicy(value: unknown): PresetToolPolicy {
  const record = asRecord(value);
  const disabled = uniqueStrings(record?.disabled);
  const groups: ToolGroupPolicy[] = [];
  const seen = new Set<string>();

  for (const value of Array.isArray(record?.groups) ? record.groups : []) {
    const group = asRecord(value);
    const name = groupNameOf(group);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    const description = groupDescriptionOf(group);
    const patterns = uniqueStrings(group?.patterns);
    const loading = groupLoadingOf(group?.loading);
    const groupDisabled = uniqueStrings(group?.disabled)
      .filter((tool) => matchesAnyPattern(tool, patterns));
    groups.push({
      name,
      ...(description ? { description } : {}),
      patterns,
      ...(loading === undefined ? {} : { loading }),
      ...(groupDisabled.length === 0 ? {} : { disabled: groupDisabled }),
    });
  }

  const mode = record?.mode === "mcp" ? "mcp" as const : undefined;
  const keepAfterCompaction = keepCountOf(record?.keepAfterCompaction);
  return {
    disabled,
    groups,
    ...(mode === undefined ? {} : { mode }),
    ...(keepAfterCompaction === undefined ? {} : { keepAfterCompaction }),
  };
}

/**
 * A whole, non-negative count of groups, or `undefined` when the value cannot
 * express one. `0` is meaningful ("keep none"), so only absence and invalid
 * values fall back to the unlimited default.
 */
function keepCountOf(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return undefined;
  return value;
}

/**
 * Read one group's loading mode. Missing and `ondemand` both mean the default,
 * so the field is omitted when the value is not worth persisting.
 */
function groupLoadingOf(value: unknown): GroupLoading | undefined {
  return value === "always" || value === "off" ? value : undefined;
}

/** Whether this preset loads tools MCP-style instead of by on-demand groups. */
export function isMcpMode(policy: PresetToolPolicy): boolean {
  return policy.mode === "mcp";
}

export function policyFor(
  settings: ToolManagerSettings,
  presetId: string | undefined,
): PresetToolPolicy {
  if (!presetId) return EMPTY_PRESET_POLICY;
  return settings.presets[presetId] ?? EMPTY_PRESET_POLICY;
}

export function resolveGroups(
  policy: PresetToolPolicy,
  toolNames: readonly string[],
): ResolvedGroupView[] {
  return policy.groups.map((group) => ({
    name: group.name,
    ...(group.description ? { description: group.description } : {}),
    patterns: [...group.patterns],
    loading: group.loading ?? "ondemand",
    disabled: Array.isArray(group.disabled) ? [...group.disabled] : [],
    tools: toolNames.filter((name) => isGroupableTool(name) && matchesAnyPattern(name, group.patterns)),
  }));
}

export interface GroupConflict {
  tool: string;
  groups: string[];
}

export interface GroupPolicyIssues {
  emptyGroups: string[];
  disabledMembers: GroupConflict[];
  duplicateMembers: GroupConflict[];
}

/**
 * Groups whose members survive the preset-level and group-level disables,
 * in policy order. A tool belongs to the first group that matches it; this is
 * how overlapping wildcards stay deterministic, and how a group in `always`
 * mode still owns its tools for the purpose of duplicate detection.
 */
export function resolveActiveGroups(
  policy: PresetToolPolicy,
  toolNames: readonly string[],
): ResolvedGroupView[] {
  const disabled = new Set(policy.disabled);
  const claimed = new Set<string>();
  const active: ResolvedGroupView[] = [];
  for (const group of resolveGroups(policy, toolNames)) {
    const groupDisabled = new Set(group.disabled);
    const tools = group.tools.filter((name) => (
      !disabled.has(name) && !groupDisabled.has(name) && !claimed.has(name)
    ));
    // Claim every matched name, even one disabled by this group: first-match
    // ownership must not let a later group resurrect a group-disabled tool.
    for (const name of group.tools) claimed.add(name);
    if (tools.length === 0) continue;
    active.push({ ...group, tools });
  }
  return active;
}

/** Groups that still need `tool_list` / `tool_find`; `always` and `off` do not. */
export function resolveOnDemandGroups(
  policy: PresetToolPolicy,
  toolNames: readonly string[],
): ResolvedGroupView[] {
  return resolveActiveGroups(policy, toolNames).filter((group) => group.loading === "ondemand");
}

export function groupPolicyIssues(
  policy: PresetToolPolicy,
  toolNames: readonly string[],
): GroupPolicyIssues {
  const disabled = new Set(policy.disabled);
  const owners = new Map<string, string[]>();
  const emptyGroups: string[] = [];
  const disabledMembers: GroupConflict[] = [];
  for (const group of resolveGroups(policy, toolNames)) {
    const groupDisabled = new Set(group.disabled);
    const enabled = group.tools.filter((name) => !disabled.has(name) && !groupDisabled.has(name));
    if (enabled.length === 0) emptyGroups.push(group.name);
    for (const name of group.tools) {
      // A preset-level disabled name inside a group's patterns is invalid:
      // membership has one owner for its disabled state, not two.
      if (disabled.has(name)) disabledMembers.push({ tool: name, groups: [group.name] });
      const groups = owners.get(name) ?? [];
      groups.push(group.name);
      owners.set(name, groups);
    }
  }
  const duplicateMembers = [...owners]
    .filter(([, groups]) => groups.length > 1)
    .map(([tool, groups]) => ({ tool, groups }));
  return { emptyGroups, disabledMembers, duplicateMembers };
}

export function hiddenTools(
  policy: PresetToolPolicy,
  toolNames: readonly string[],
): Set<string> {
  const hidden = new Set<string>();
  const owners = groupOwners(policy, toolNames);
  for (const name of toolNames) {
    if (policy.disabled.includes(name)) {
      hidden.add(name);
      continue;
    }
    const owner = owners.get(name);
    if (owner === undefined) continue;
    if (owner.loading !== "always" || owner.disabled.includes(name)) hidden.add(name);
  }
  return hidden;
}

/** First-match group ownership across every group, including `always` and `off`. */
function groupOwners(
  policy: PresetToolPolicy,
  toolNames: readonly string[],
): Map<string, ResolvedGroupView> {
  const owners = new Map<string, ResolvedGroupView>();
  for (const group of resolveGroups(policy, toolNames)) {
    for (const name of group.tools) {
      if (!owners.has(name)) owners.set(name, group);
    }
  }
  return owners;
}

/**
 * Names `tools.restrict({ deny })` may legally receive for the current
 * inherited baseline: grouped tools that are not currently exposed, plus
 * every explicit disable. The PTC transport is never denied. `tool_list` is
 * registered globally so PTC's SDK can bind it. Presets with no active
 * on-demand groups hide it here so restrict() can deny the inherited name.
 */
export function denyNames(
  policy: PresetToolPolicy,
  toolNames: readonly string[],
  exposures: ReadonlySet<string>,
): string[] {
  if (isMcpMode(policy)) return mcpDenyNames(policy, toolNames);
  const groups = resolveOnDemandGroups(policy, toolNames);
  const owners = groupOwners(policy, toolNames);
  const open = new Set([...exposures].map((name) => name.toLowerCase()));
  const hidden = new Set<string>();

  for (const name of toolNames) {
    if (policy.disabled.includes(name)) {
      hidden.add(name);
      continue;
    }
    const owner = owners.get(name);
    if (owner === undefined) continue;
    const groupDisabled = owner.disabled.includes(name);
    if (owner.loading === "always") {
      if (groupDisabled) hidden.add(name);
      continue;
    }
    // `off` groups never load; `ondemand` groups load only after opening.
    if (owner.loading === "off" || !open.has(owner.name.toLowerCase()) || groupDisabled) {
      hidden.add(name);
    }
  }

  hidden.delete(PTC_TRANSPORT_NAME);
  if (groups.length > 0) hidden.delete(DISCOVERY_TOOL_NAME);
  else if (toolNames.includes(DISCOVERY_TOOL_NAME)) hidden.add(DISCOVERY_TOOL_NAME);
  // `tool_find` is registered globally as soon as ANY preset runs mcp mode. A
  // groups-mode preset must never see it: the finder belongs to mcp mode.
  if (toolNames.includes(MCP_FIND_TOOL_NAME)) hidden.add(MCP_FIND_TOOL_NAME);
  return toolNames.filter((name) => hidden.has(name));
}

function mcpDenyNames(
  policy: PresetToolPolicy,
  toolNames: readonly string[],
): string[] {
  const disabled = new Set(policy.disabled);
  const owners = groupOwners(policy, toolNames);
  const hidden: string[] = [];
  for (const name of toolNames) {
    if (name === PTC_TRANSPORT_NAME) continue;
    // In mcp mode every registered tool stays callable; the declaration set
    // hides explicit disables, closed groups, and disabled group members.
    if (disabled.has(name) || name === DISCOVERY_TOOL_NAME) {
      hidden.push(name);
      continue;
    }
    const owner = owners.get(name);
    if (owner !== undefined && (owner.loading === "off" || owner.disabled.includes(name))) {
      hidden.push(name);
    }
  }
  return hidden;
}

/**
 * Tools hidden behind their group in mcp mode.
 *
 * A grouped tool is not declared at all: the model sees the group in the
 * catalog and reads every member's schema with `tool_find({ group })`. The
 * registration itself is untouched, so the tool stays directly callable.
 * Only `ondemand` groups participate; `always` groups are declared normally,
 * and `off` groups are removed from the callable set by {@link mcpDenyNames}.
 */
export function mcpGroupedNames(
  policy: PresetToolPolicy,
  toolNames: readonly string[],
): string[] {
  if (!isMcpMode(policy)) return [];
  const grouped: string[] = [];
  for (const group of resolveOnDemandGroups(policy, toolNames)) {
    for (const name of group.tools) grouped.push(name);
  }
  return grouped;
}

/** The on-demand groups an mcp-mode preset exposes in its catalog. */
export function mcpGroups(
  policy: PresetToolPolicy,
  toolNames: readonly string[],
): ResolvedGroupView[] {
  if (!isMcpMode(policy)) return [];
  return resolveOnDemandGroups(policy, toolNames);
}

/** First group whose patterns claim one tool. */
export function groupForTool(
  policy: PresetToolPolicy,
  toolNames: readonly string[],
  toolName: string,
): ResolvedGroupView | undefined {
  return resolveGroups(policy, toolNames).find((group) => group.tools.includes(toolName));
}

export function emptyGroupNames(
  policy: PresetToolPolicy,
  toolNames: readonly string[],
): string[] {
  return groupPolicyIssues(policy, toolNames).emptyGroups;
}

export function policyOrphans(
  policy: PresetToolPolicy,
  toolNames: readonly string[],
): PresetOrphans {
  const present = new Set(toolNames);
  return {
    disabled: policy.disabled.filter((name) => !present.has(name)),
    emptyGroups: emptyGroupNames(policy, toolNames),
  };
}

export function listGroupViews(
  groups: readonly ResolvedGroupView[],
  exposures: ReadonlySet<string>,
): ToolListGroupView[] {
  const open = new Set([...exposures].map((name) => name.toLowerCase()));
  return groups.map((group) => ({
    name: group.name,
    ...(group.description ? { description: group.description } : {}),
    exposed: open.has(group.name.toLowerCase()),
  }));
}

export function findGroup(
  groups: readonly ResolvedGroupView[],
  requested: string,
): ResolvedGroupView | undefined {
  const needle = requested.trim().toLowerCase();
  if (!needle) return undefined;
  return groups.find((group) => group.name.toLowerCase() === needle);
}

export function matchesAnyPattern(value: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => matchesPattern(value, pattern));
}

function isGroupableTool(name: string): boolean {
  return name !== DISCOVERY_TOOL_NAME && name !== PTC_TRANSPORT_NAME;
}

export function matchesPattern(value: string, pattern: string): boolean {
  if (!pattern.includes("*")) return value === pattern;
  const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(value);
}

export function sameNames(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((name, index) => name === right[index]);
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

export function normalizeGroupName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function groupNameOf(group: Record<string, unknown> | undefined): string {
  if (!group) return "";
  if (typeof group.name === "string") return normalizeGroupName(group.name);
  if (typeof group.id === "string") return normalizeGroupName(group.id);
  return "";
}

function groupDescriptionOf(group: Record<string, unknown> | undefined): string | undefined {
  if (!group) return undefined;
  if (typeof group.description === "string" && group.description.trim()) return group.description.trim();
  if (typeof group.label === "string" && group.label.trim()) return group.label.trim();
  return undefined;
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean),
  )];
}

export function parseKnownRestrictable(error: unknown): Set<string> | undefined {
  const message = error instanceof Error ? error.message : String(error);
  const marker = "known global tools: ";
  const index = message.lastIndexOf(marker);
  if (index < 0) return undefined;
  const listed = message.slice(index + marker.length).trim();
  if (!listed || listed === "(none)") return new Set();
  return new Set(listed.split(", ").map((item) => item.trim()).filter(Boolean));
}
