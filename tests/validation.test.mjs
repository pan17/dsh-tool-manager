import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertNoEmptyGroups } from "../dist/index.js";

function presetService(inventory, schemasByPreset = {}) {
  return {
    async compositionInventory() {
      return inventory;
    },
    async standingKeyFor(id) {
      if (!(id in schemasByPreset)) throw new Error(`unavailable ${id}`);
      return id;
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
});
