import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toolCatalogStats } from "../dist/stats.js";

const tools = ["read", "write", "web_search", "web_fetch", "old"].map((name) => ({ name }));

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
