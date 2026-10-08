import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertNoEmptyGroups } from "../dist/index.js";

function presetService(inventory, schemasByPreset = {}) {
  return {
    async compositionInventory() {
      return inventory;
    },
    async acquireScope(id) {
      if (!(id in schemasByPreset)) throw new Error(`unavailable ${id}`);
      return {
        key: id,
        async [Symbol.asyncDispose]() {},
      };
    },
  };
}

function toolService(schemasByPreset) {
  return {
    schemas(key) {
      return (schemasByPreset[key] || []).map((name) => ({
        name,
        description: "",
        parameters: {},
      }));
    },
  };
}

describe("tool-manager save validation", () => {
  it("accepts non-overlapping groups that resolve to available tools", async () => {
    const schemas = { standard: ["read", "web_search"] };
    await assertNoEmptyGroups(
      presetService([{ id: "standard", trust: "system", isDefault: true }], schemas),
      toolService(schemas),
      {
        presets: {
          standard: {
            disabled: [],
            groups: [
              { name: "Search", patterns: ["web_search"] },
              { name: "Files", patterns: ["read"] },
            ],
          },
        },
      },
    );
  });

  it("rejects groups containing disabled tools", async () => {
    const schemas = { standard: ["read"] };
    const presets = presetService([{ id: "standard", trust: "system", isDefault: true }], schemas);
    const tools = toolService(schemas);
    await assert.rejects(
      () => assertNoEmptyGroups(presets, tools, {
        presets: {
          standard: {
            disabled: ["read"],
            groups: [{ name: "Disabled", patterns: ["read"] }],
          },
        },
      }),
      /disabled tool "read" in group "Disabled"/,
    );
  });

  it("rejects exact and wildcard overlaps across groups", async () => {
    const schemas = { standard: ["web_search", "web_fetch"] };
    const presets = presetService([{ id: "standard", trust: "system", isDefault: true }], schemas);
    const tools = toolService(schemas);
    await assert.rejects(
      () => assertNoEmptyGroups(presets, tools, {
        presets: {
          standard: {
            disabled: [],
            groups: [
              { name: "Web", patterns: ["web_*"] },
              { name: "Search", patterns: ["web_search"] },
            ],
          },
        },
      }),
      /assigns tool "web_search" to multiple groups: "Web", "Search"/,
    );
  });

  it("rejects groups with no patterns or no matching tools", async () => {
    const schemas = { standard: ["read"] };
    const presets = presetService([{ id: "standard", trust: "system", isDefault: true }], schemas);
    const tools = toolService(schemas);
    await assert.rejects(
      () => assertNoEmptyGroups(presets, tools, {
        presets: {
          standard: {
            disabled: [],
            groups: [
              { name: "No selection", patterns: [] },
              { name: "Missing", patterns: ["web_*"] },
            ],
          },
        },
      }),
      /empty tool groups: "No selection", "Missing"/,
    );
  });

  it("does not reject an uninspectable or broken preset", async () => {
    const inventory = [
      { id: "broken", trust: "user", isDefault: false, broken: "bad composition" },
      { id: "unavailable", trust: "user", isDefault: false },
    ];
    await assertNoEmptyGroups(
      presetService(inventory),
      toolService({}),
      {
        presets: {
          broken: { disabled: [], groups: [{ name: "Old", patterns: [] }] },
          unavailable: { disabled: [], groups: [{ name: "Old 2", patterns: [] }] },
        },
      },
    );
  });

  // A plugin may register tools into each Agent's OWN scope rather than the
  // Preset's standing composition: `dsh-schedule` attaches the four
  // `schedule_*` tools to every root Agent, `dsh-tool-subagent` injects
  // `subagent`. The settings page lists them (standing unioned with live/probe
  // observations) and the runtime opens them, so save validation must read the
  // same catalog instead of rejecting the group as empty.
  it("accepts a group built only from Agent-scoped tools", async () => {
    const schemas = { standard: ["read", "web_search"] };
    const agentScoped = ["schedule_create", "schedule_list", "schedule_delete", "schedule_update"];
    await assertNoEmptyGroups(
      presetService([{ id: "standard", trust: "system", isDefault: true }], schemas),
      toolService(schemas),
      {
        presets: {
          standard: {
            disabled: [],
            groups: [{ name: "定时提醒管理", patterns: agentScoped }],
          },
        },
      },
      undefined,
      (presetId) => [...schemas[presetId], ...agentScoped],
    );
  });

  it("still rejects a group whose members are absent from the merged catalog", async () => {
    const schemas = { standard: ["read"] };
    await assert.rejects(
      () => assertNoEmptyGroups(
        presetService([{ id: "standard", trust: "system", isDefault: true }], schemas),
        toolService(schemas),
        {
          presets: {
            standard: { disabled: [], groups: [{ name: "Missing", patterns: ["schedule_create"] }] },
          },
        },
        undefined,
        (presetId) => schemas[presetId],
      ),
      /empty tool groups: "Missing"/,
    );
  });

  it("detects conflicts between two Agent-scoped groups through the merged catalog", async () => {
    const schemas = { standard: ["read"] };
    const agentScoped = ["schedule_create", "schedule_list"];
    const merged = (presetId) => [...schemas[presetId], ...agentScoped];
    const presets = presetService([{ id: "standard", trust: "system", isDefault: true }], schemas);
    const tools = toolService(schemas);
    await assert.rejects(
      () => assertNoEmptyGroups(presets, tools, {
        presets: {
          standard: {
            disabled: [],
            groups: [
              { name: "A", patterns: ["schedule_create"] },
              { name: "B", patterns: ["schedule_create"] },
            ],
          },
        },
      }, undefined, merged),
      /assigns tool "schedule_create" to multiple groups: "A", "B"/,
    );
    await assert.rejects(
      () => assertNoEmptyGroups(presets, tools, {
        presets: {
          standard: {
            disabled: ["schedule_create"],
            groups: [{ name: "A", patterns: ["schedule_create"] }],
          },
        },
      }, undefined, merged),
      /disabled tool "schedule_create" in group "A"/,
    );
  });

  it("skips a preset whose merged catalog cannot be read", async () => {
    const schemas = { standard: ["read"] };
    await assertNoEmptyGroups(
      presetService([{ id: "standard", trust: "system", isDefault: true }], schemas),
      toolService(schemas),
      {
        presets: {
          standard: { disabled: [], groups: [{ name: "Unknown", patterns: ["anything"] }] },
        },
      },
      undefined,
      () => undefined,
    );
  });
});
