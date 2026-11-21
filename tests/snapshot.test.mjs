import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderCatalogLine } from "../dist/catalog.js";
import { buildSnapshot, mergeSchemas } from "../dist/snapshot.js";
import { estimateToolTokens, estimateToolsTokens } from "../dist/stats.js";

function schema(name, description = name) {
  return { name, description, parameters: {} };
}

describe("snapshot schema merging", () => {
  it("includes agent-scoped tools missing from the standing preset view", () => {
    const merged = mergeSchemas(
      [schema("read"), schema("subagent_fork")],
      [schema("subagent", "agent-scoped delegation"), schema("read", "newer scoped schema")],
    );

    assert.deepEqual(merged.map((item) => item.name), ["read", "subagent_fork", "subagent"]);
    assert.equal(merged.find((item) => item.name === "read").description, "newer scoped schema");
  });

  it("reads standing schemas through acquireScope and always releases the lease", async () => {
    const released = [];
    const presets = {
      async compositionInventory() {
        return [{ id: "standard", isDefault: true }];
      },
      async acquireScope(id) {
        assert.equal(id, "standard");
        return {
          key: "standing-standard",
          async [Symbol.asyncDispose]() {
            released.push(id);
          },
        };
      },
    };
    const tools = {
      schemas(key) {
        assert.equal(key, "standing-standard");
        return [schema("read"), schema("tool_list"), schema("run_code")];
      },
    };

    const snapshot = await buildSnapshot(presets, tools, { presets: {} }, 1, "/tmp/tool-manager.json");

    assert.deepEqual(snapshot.presets.map((item) => item.id), ["standard"]);
    assert.deepEqual(snapshot.presets[0].tools.map((item) => item.name), ["read"]);
    // DSH stopped reporting preset trust; the snapshot must not invent one.
    assert.equal(snapshot.presets[0].trust, undefined);
    assert.deepEqual(released, ["standard"]);
  });

  it("still releases the standing lease when schema projection throws", async () => {
    const released = [];
    const presets = {
      async compositionInventory() {
        return [{ id: "standard", isDefault: true }];
      },
      async acquireScope() {
        return {
          key: "standing-standard",
          async [Symbol.asyncDispose]() {
            released.push("standard");
          },
        };
      },
    };
    const tools = {
      schemas() {
        throw new Error("schemas unavailable");
      },
    };

    const snapshot = await buildSnapshot(presets, tools, { presets: {} }, 1, "/tmp/tool-manager.json");

    assert.equal(snapshot.presets[0].broken, "schemas unavailable");
    assert.equal(snapshot.presets[0].tokenStats, undefined);
    assert.deepEqual(released, ["standard"]);
  });

  it("attaches per-tool, per-group, and preset token estimates", async () => {
    const presets = {
      async compositionInventory() {
        return [{ id: "standard", isDefault: true }];
      },
      async acquireScope() {
        return { key: "standing-standard", async [Symbol.asyncDispose]() {} };
      },
    };
    const catalog = [
      schema("read", "Read a file"),
      schema("web_search", "Search the web"),
      schema("web_fetch", "Fetch a page"),
      schema("old", "Old tool"),
    ];
    const tools = { schemas: () => catalog };
    const settings = {
      presets: {
        standard: {
          disabled: ["old"],
          groups: [
            { name: "Web", description: "Web tools", patterns: ["web_*"] },
            { name: "Empty", patterns: ["missing_*"] },
          ],
        },
      },
    };

    const snapshot = await buildSnapshot(presets, tools, settings, 1, "/tmp/tool-manager.json");
    const preset = snapshot.presets[0];
    const group = preset.groups[0];

    assert.deepEqual(preset.tools.map((tool) => tool.tokens), catalog.map(estimateToolTokens));
    const schemaTokens = estimateToolTokens(catalog[1]) + estimateToolTokens(catalog[2]);
    const catalogTokens = Math.ceil(renderCatalogLine({
      name: "Web",
      description: "Web tools",
      tools: ["web_search", "web_fetch"],
    }).length / 4);
    assert.deepEqual(group.tokens, {
      schema: schemaTokens,
      catalog: catalogTokens,
      net: schemaTokens - catalogTokens,
    });
    assert.deepEqual(preset.groups[1].tokens, { schema: 0, catalog: 0, net: 0 });
    assert.deepEqual(preset.tokenStats, {
      totalTokens: estimateToolsTokens(catalog),
      alwaysOnTools: 1,
      alwaysOnTokens: estimateToolsTokens([catalog[0]]),
      onDemandTools: 2,
      onDemandTokens: estimateToolTokens(catalog[1]) + estimateToolTokens(catalog[2]),
      onDemandGroups: 1,
      onDemandSavings: schemaTokens - catalogTokens,
      disabledTools: 1,
      disabledTokens: estimateToolsTokens([catalog[3]]),
    });
  });
});
