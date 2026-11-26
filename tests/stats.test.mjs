import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderCatalogLine } from "../dist/catalog.js";
import {
  estimateGroupTokens,
  estimateToolTokens,
  estimateToolsTokens,
  presetTokenStats,
  toolCatalogStats,
} from "../dist/stats.js";

const tools = ["read", "write", "web_search", "web_fetch", "old"].map((name) => ({ name }));

const schemas = [
  { name: "read", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } } } },
  { name: "web_search", description: "Search the web", parameters: { type: "object", properties: { query: { type: "string" } } } },
  { name: "web_fetch", description: "Fetch a page", parameters: { type: "object", properties: { url: { type: "string" } } } },
  { name: "old", description: "Old tool", parameters: {} },
];

describe("tool-manager catalog stats", () => {
  it("classifies real tools into exclusive states", () => {
    const stats = toolCatalogStats(tools, {
      disabled: ["old", "missing_orphan"],
      groups: [
        { name: "Web", patterns: ["web_*"] },
        { name: "Search duplicate", patterns: ["web_search"] },
        { name: "Empty", patterns: ["missing_*"] },
      ],
    });
    assert.deepEqual(stats, {
      totalTools: 5,
      groupCount: 3,
      ungroupedTools: 2,
      onDemandTools: 2,
      disabledTools: 1,
    });
    assert.equal(stats.ungroupedTools + stats.onDemandTools + stats.disabledTools, stats.totalTools);
  });

  it("counts disabled before grouped", () => {
    assert.deepEqual(toolCatalogStats(tools, {
      disabled: ["web_search"],
      groups: [{ name: "Web", patterns: ["web_*"] }],
    }), {
      totalTools: 5,
      groupCount: 1,
      ungroupedTools: 3,
      onDemandTools: 1,
      disabledTools: 1,
    });
  });

  it("classifies always, on-demand, off, and group-disabled members", () => {
    assert.deepEqual(toolCatalogStats(tools, {
      disabled: ["old"],
      groups: [
        { name: "Always", patterns: ["read", "write"], loading: "always", disabled: ["write"] },
        { name: "OnDemand", patterns: ["web_*"] },
        { name: "Off", patterns: ["missing_*"], loading: "off" },
      ],
    }), {
      totalTools: 5,
      groupCount: 3,
      ungroupedTools: 1,
      onDemandTools: 2,
      disabledTools: 2,
    });
  });

  it("handles an empty preset and configured empty groups", () => {
    assert.deepEqual(toolCatalogStats([], {
      disabled: ["missing"],
      groups: [{ name: "Empty", patterns: [] }],
    }), {
      totalTools: 0,
      groupCount: 1,
      ungroupedTools: 0,
      onDemandTools: 0,
      disabledTools: 0,
    });
  });
});

describe("tool-manager token estimates", () => {
  it("uses the host's 4 characters per token projection", () => {
    for (const schema of schemas) {
      const expected = Math.ceil(JSON.stringify({
        name: schema.name,
        description: schema.description,
        parameters: schema.parameters,
      }).length / 4);
      assert.equal(estimateToolTokens(schema), expected);
    }
  });

  it("counts an empty tool array as zero and keeps array framing", () => {
    assert.equal(estimateToolsTokens([]), 0);
    assert.equal(estimateToolsTokens(schemas), Math.ceil(JSON.stringify(schemas).length / 4) + 4);
  });

  it("subtracts the closed-state catalog line from group schema tokens", () => {
    const group = { name: "Web", description: "Web tools", tools: ["web_search", "web_fetch"] };
    const estimate = estimateGroupTokens(group, schemas);
    const schema = estimateToolTokens(schemas[1]) + estimateToolTokens(schemas[2]);
    const catalog = Math.ceil(renderCatalogLine({
      name: "Web",
      description: "Web tools",
      tools: ["web_search", "web_fetch"],
    }).length / 4);

    assert.deepEqual(estimate, { schema, catalog, net: schema - catalog });
  });

  it("keeps an empty group at zero because it never enters the catalog", () => {
    assert.deepEqual(estimateGroupTokens({ name: "Empty", tools: [] }, schemas), {
      schema: 0,
      catalog: 0,
      net: 0,
    });
  });

  it("summarizes always-on tools and first-match group savings", () => {
    const policy = {
      disabled: ["old"],
      groups: [
        { name: "Web", description: "Web tools", patterns: ["web_*"] },
        { name: "Search duplicate", patterns: ["web_search"] },
      ],
    };
    const stats = presetTokenStats(schemas, policy);
    const group = estimateGroupTokens(
      { name: "Web", description: "Web tools", tools: ["web_search", "web_fetch"] },
      schemas,
    );

    assert.equal(stats.totalTokens, estimateToolsTokens(schemas));
    assert.equal(stats.alwaysOnTools, 1);
    assert.equal(stats.alwaysOnTokens, estimateToolsTokens([schemas[0]]));
    assert.equal(stats.onDemandTools, 2);
    assert.equal(stats.onDemandTokens, estimateToolTokens(schemas[1]) + estimateToolTokens(schemas[2]));
    assert.equal(stats.onDemandGroups, 1);
    assert.equal(stats.onDemandSavings, group.net);
    assert.equal(stats.disabledTools, 1);
    assert.equal(stats.disabledTokens, estimateToolsTokens([schemas[3]]));
  });

  it("separates always, on-demand, off, and group-disabled tools in token stats", () => {
    const policy = {
      disabled: ["old"],
      groups: [
        { name: "Always", patterns: ["read"], loading: "always" },
        { name: "OnDemand", patterns: ["web_*"], disabled: ["web_search"] },
        { name: "Off", patterns: ["missing_*"], loading: "off" },
      ],
    };
    const stats = presetTokenStats(schemas, policy);
    assert.equal(stats.alwaysOnTools, 1);
    assert.equal(stats.alwaysOnTokens, estimateToolsTokens([schemas[0]]));
    assert.equal(stats.onDemandTools, 1);
    assert.equal(stats.onDemandGroups, 1);
    assert.equal(stats.disabledTools, 2);
    assert.equal(stats.disabledTokens, estimateToolsTokens([schemas[1], schemas[3]]));
  });

  it("prices a transport that renders one document per tool plus a fixed floor", () => {
    const priced = schemas.map((schema) => ({ ...schema, tokens: estimateToolTokens(schema) + 10 }));
    const policy = {
      disabled: ["old"],
      groups: [{ name: "Web", description: "Web tools", patterns: ["web_*"] }],
    };
    const stats = presetTokenStats(priced, policy, { constantTokens: 500 });
    const resident = (list) => list.reduce((sum, tool) => sum + tool.tokens, 0);

    assert.equal(stats.totalTokens, resident(priced) + 500);
    assert.equal(stats.alwaysOnTokens, resident([priced[0]]));
    assert.equal(stats.onDemandTokens, resident([priced[1], priced[2]]));
    assert.equal(stats.disabledTokens, resident([priced[3]]));
    // Without a transport model the numbers stay the Host's JSON projection.
    assert.equal(presetTokenStats(schemas, policy).totalTokens, estimateToolsTokens(schemas));
  });
});
