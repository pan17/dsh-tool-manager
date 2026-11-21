import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { estimateGroupTokens as hostEstimateGroupTokens, presetTokenStats as hostPresetTokenStats } from "../dist/stats.js";

function loadClient() {
  let definition;
  const context = {
    window: {
      __ModuleLoader__: {
        load(value) { definition = value; },
      },
    },
    console,
  };
  vm.runInNewContext(readFileSync(new URL("../dist/client.js", import.meta.url), "utf8"), context);
  return definition.factory(() => ({}));
}

const client = loadClient();

function schema(name, description, parameters = { type: "object" }) {
  return { name, description, parameters };
}

function preset(tools, policy = { disabled: [], groups: [] }) {
  return { id: "standard", tools, policy };
}

describe("client token estimates", () => {
  it("matches the Host's 4 characters per token projection", () => {
    const tool = schema("read", "Read a file", { type: "object", properties: { path: { type: "string" } } });
    assert.equal(
      client.estimateToolTokens(tool),
      Math.ceil(JSON.stringify({ name: tool.name, description: tool.description, parameters: tool.parameters }).length / 4),
    );
  });

  it("nets a group against the catalog line while it is closed", () => {
    const tools = [schema("web_search", "Search the web"), schema("web_fetch", "Fetch a page")];
    const group = { name: "Web", description: "Web tools", patterns: ["web_*"] };
    const estimate = client.estimateGroupTokens(group, tools);
    const schemaTokens = tools.reduce((sum, tool) => sum + client.estimateToolTokens(tool), 0);
    const catalog = Math.ceil(("- Web (2 tools): Web tools\n  Tools: web_search, web_fetch").length / 4);

    assert.deepEqual(JSON.parse(JSON.stringify(estimate)), { schema: schemaTokens, catalog, net: schemaTokens - catalog });
    assert.deepEqual(
      JSON.parse(JSON.stringify(client.estimateGroupTokens({ name: "Empty", patterns: [] }, []))),
      { schema: 0, catalog: 0, net: 0 },
    );
  });

  it("deduplicates overlapping groups first-match and includes always-on tools", () => {
    const tools = [
      schema("read", "Read a file"),
      schema("web_search", "Search the web"),
      schema("web_fetch", "Fetch a page"),
      schema("old", "Old tool"),
    ];
    const value = preset(tools, {
      disabled: ["old"],
      groups: [
        { name: "Web", description: "Web tools", patterns: ["web_*"] },
        { name: "Duplicate", patterns: ["web_search"] },
      ],
    });
    const stats = client.presetTokenStats(value);

    assert.equal(stats.totalTokens, client.estimateToolsTokens(tools));
    assert.equal(stats.alwaysOnTools, 1);
    assert.equal(stats.alwaysOnTokens, client.estimateToolsTokens([tools[0]]));
    assert.equal(stats.onDemandTools, 2);
    assert.equal(stats.onDemandTokens, client.estimateToolTokens(tools[1]) + client.estimateToolTokens(tools[2]));
    assert.equal(stats.onDemandGroups, 1);
    assert.equal(stats.onDemandSavings, client.estimateGroupTokens(
      { name: "Web", description: "Web tools", patterns: ["web_*"] },
      [tools[1], tools[2]],
    ).net);
    assert.equal(stats.disabledTools, 1);
    assert.equal(stats.disabledTokens, client.estimateToolsTokens([tools[3]]));
  });

  it("escapes catalog text exactly like the Host estimator", () => {
    const tools = [schema("web<&>", "Fetch <pages> & more")];
    const group = { name: "Web <&>", description: "Tools & pages", patterns: ["web<&>"] };

    assert.deepEqual(
      JSON.parse(JSON.stringify(client.estimateGroupTokens(group, tools))),
      JSON.parse(JSON.stringify(hostEstimateGroupTokens({ name: group.name, description: group.description, tools: ["web<&>"] }, tools))),
    );
  });

  it("keeps a PTC summary identical to the Host additive estimator", () => {
    const tools = [
      schema("read", "Read a file"),
      schema("web_search", "Search the web"),
      schema("web_fetch", "Fetch a page"),
      schema("old", "Old tool"),
    ].map((tool, index) => ({ ...tool, tokens: 100 + index * 37 }));
    const policy = {
      disabled: ["old"],
      groups: [{ name: "Web", description: "Web tools", patterns: ["web_*"] }],
    };
    const value = { id: "standard", tools, policy, transport: "ptc", constantTokens: 321 };

    assert.deepEqual(
      JSON.parse(JSON.stringify(client.presetTokenStats(value))),
      JSON.parse(JSON.stringify(hostPresetTokenStats(tools, policy, { constantTokens: 321 }))),
    );
    assert.equal(client.presetTokenStats(value).totalTokens, 100 + 137 + 174 + 211 + 321);
  });

  it("keeps the client summary identical to the Host estimator", () => {
    const tools = [
      schema("read", "Read a file"),
      schema("web_search", "Search the web"),
      schema("web_fetch", "Fetch a page"),
      schema("old", "Old tool"),
    ];
    const value = preset(tools, {
      disabled: ["old"],
      groups: [{ name: "Web", description: "Web tools", patterns: ["web_*"] }],
    });

    assert.deepEqual(
      JSON.parse(JSON.stringify(client.presetTokenStats(value))),
      JSON.parse(JSON.stringify(hostPresetTokenStats(tools, value.policy))),
    );
  });

  it("formats compact token counts for the summary line", () => {
    assert.equal(client.formatTokenCount(950), "950");
    assert.equal(client.formatTokenCount(11541), "11.5k");
    assert.equal(client.formatTokenCount(23501), "23.5k");
    assert.equal(client.formatTokenCount(0), "0");
    assert.equal(client.formatTokenCount(null), "—");
  });
});
