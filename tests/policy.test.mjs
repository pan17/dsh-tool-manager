import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  denyNames,
  findGroup,
  groupForTool,
  groupPolicyIssues,
  hiddenTools,
  listGroupViews,
  matchesPattern,
  mcpGroupedNames,
  mcpGroups,
  normalizeGroupName,
  normalizeSettings,
  parseKnownRestrictable,
  policyOrphans,
  resolveActiveGroups,
  resolveGroups,
  resolveOnDemandGroups,
} from "../dist/policy.js";

describe("tool-manager policy", () => {
  it("normalizes malformed settings conservatively", () => {
    assert.deepEqual(normalizeSettings({
      defaultTtlSteps: 3,
      presets: {
        standard: {
          disabled: ["web_fetch", "web_fetch", 42],
          groups: [
            { id: "MCP", label: "GitHub tools", patterns: ["mcp__*"], ttlSteps: 4 },
            { id: "mcp", patterns: ["ignored"] },
            { name: "empty", patterns: [] },
          ],
        },
      },
    }), {
      presets: {
        standard: {
          disabled: ["web_fetch"],
          groups: [
            { name: "MCP", description: "GitHub tools", patterns: ["mcp__*"] },
            { name: "empty", patterns: [] },
          ],
        },
      },
    });
  });

  it("normalizes group loading and disabled members without writing defaults", () => {
    assert.deepEqual(normalizeSettings({
      presets: {
        standard: {
          disabled: [],
          groups: [
            { name: "Always", patterns: ["a", "b"], loading: "always", disabled: ["a", "missing"] },
            { name: "Off", patterns: ["c*"], loading: "off", disabled: ["c_one"] },
            { name: "Default", patterns: ["d"], loading: "ondemand", disabled: [] },
          ],
        },
      },
    }), {
      presets: {
        standard: {
          disabled: [],
          groups: [
            { name: "Always", patterns: ["a", "b"], loading: "always", disabled: ["a"] },
            { name: "Off", patterns: ["c*"], loading: "off", disabled: ["c_one"] },
            { name: "Default", patterns: ["d"] },
          ],
        },
      },
    });
  });

  it("resolves always, on-demand, off, and group-disabled members", () => {
    const policy = {
      disabled: [],
      groups: [
        { name: "Always", patterns: ["a*"], loading: "always", disabled: ["a2"] },
        { name: "OnDemand", patterns: ["b*"] },
        { name: "Off", patterns: ["c*"], loading: "off", disabled: ["c1"] },
      ],
    };
    const names = ["a1", "a2", "b1", "b2", "c1", "c2", "read"];
    assert.deepEqual(resolveGroups(policy, names).map((group) => ({
      name: group.name,
      loading: group.loading,
      disabled: group.disabled,
      tools: group.tools,
    })), [
      { name: "Always", loading: "always", disabled: ["a2"], tools: ["a1", "a2"] },
      { name: "OnDemand", loading: "ondemand", disabled: [], tools: ["b1", "b2"] },
      { name: "Off", loading: "off", disabled: ["c1"], tools: ["c1", "c2"] },
    ]);
    assert.deepEqual(resolveActiveGroups(policy, names).map((group) => group.name), ["Always", "OnDemand", "Off"]);
    assert.deepEqual(resolveOnDemandGroups(policy, names).map((group) => group.name), ["OnDemand"]);
    assert.equal(groupForTool(policy, names, "c2")?.name, "Off");
    assert.equal(groupForTool(policy, names, "read"), undefined);
  });

  it("does not let a later group claim a group-disabled member", () => {
    const policy = {
      disabled: [],
      groups: [
        { name: "First", patterns: ["a*"], disabled: ["a1"] },
        { name: "Second", patterns: ["a1"] },
      ],
    };
    assert.deepEqual(resolveActiveGroups(policy, ["a1", "a2"]).map((group) => ({
      name: group.name,
      tools: group.tools,
    })), [{ name: "First", tools: ["a2"] }]);
  });

  it("denies always members only when disabled, and off groups entirely", () => {
    const policy = {
      disabled: [],
      groups: [
        { name: "Always", patterns: ["a*"], loading: "always", disabled: ["a2"] },
        { name: "OnDemand", patterns: ["b*"] },
        { name: "Off", patterns: ["c*"], loading: "off" },
      ],
    };
    const names = ["a1", "a2", "b1", "c1", "read"];
    assert.deepEqual(denyNames(policy, names, new Set()), ["a2", "b1", "c1"]);
    assert.deepEqual(denyNames(policy, names, new Set(["OnDemand"])), ["a2", "c1"]);
  });

  it("keeps mcp declarations for always groups and hides off/disabled members", () => {
    const policy = {
      mode: "mcp",
      disabled: [],
      groups: [
        { name: "Always", patterns: ["a*"], loading: "always", disabled: ["a2"] },
        { name: "OnDemand", patterns: ["b*"] },
        { name: "Off", patterns: ["c*"], loading: "off", disabled: ["c1"] },
      ],
    };
    const names = ["a1", "a2", "b1", "c1", "c2", "read"];
    assert.deepEqual(denyNames(policy, names, new Set()), ["a2", "c1", "c2"]);
    assert.deepEqual(mcpGroupedNames(policy, names), ["b1"]);
    assert.deepEqual(mcpGroups(policy, names).map((group) => group.name), ["OnDemand"]);
  });

  it("allows group-level disables but rejects preset-level overlap", () => {
    assert.deepEqual(groupPolicyIssues({
      disabled: [],
      groups: [{ name: "G", patterns: ["a", "b"], disabled: ["b"] }],
    }, ["a", "b", "c"]), {
      emptyGroups: [],
      disabledMembers: [],
      duplicateMembers: [],
    });
    assert.deepEqual(groupPolicyIssues({
      disabled: ["b"],
      groups: [{ name: "G", patterns: ["a", "b"] }],
    }, ["a", "b", "c"]), {
      emptyGroups: [],
      disabledMembers: [{ tool: "b", groups: ["G"] }],
      duplicateMembers: [],
    });
  });

  it("keeps a generation model, its effort, and an effort without a pinned route", () => {
    assert.deepEqual(normalizeSettings({
      presets: {},
      generation: { provider: " magpie ", model: " opencode-go/deepseek-v4.1-flash ", reasoningEffort: " low " },
    }), {
      presets: {},
      generation: { provider: "magpie", model: "opencode-go/deepseek-v4.1-flash", reasoningEffort: "low" },
    });

    // No complete route: the plugin keeps running the deployment default model,
    // so a chosen level is still worth storing on its own.
    assert.deepEqual(normalizeSettings({ presets: {}, generation: { reasoningEffort: " low " } }), {
      presets: {},
      generation: { reasoningEffort: "low" },
    });
    // A half-written route is dropped rather than stored as unusable.
    assert.deepEqual(normalizeSettings({ presets: {}, generation: { provider: "magpie" } }), { presets: {} });
    assert.deepEqual(normalizeSettings({ presets: {}, generation: { provider: "", model: "m" } }), { presets: {} });
    assert.deepEqual(normalizeSettings({ presets: {}, generation: { provider: "p", model: "m" } }), {
      presets: {},
      generation: { provider: "p", model: "m" },
    });
    assert.deepEqual(normalizeSettings({ presets: {}, generation: null }), { presets: {} });
    assert.deepEqual(normalizeSettings({ presets: {}, generation: "magpie/chat" }), { presets: {} });
    assert.deepEqual(normalizeSettings({ presets: {}, generation: { reasoningEffort: "" } }), { presets: {} });

    // An omitted effort means "let the model decide", not an empty effort.
    assert.deepEqual(normalizeSettings({ presets: {}, generation: { provider: "p", model: "m", reasoningEffort: "" } }), {
      presets: {},
      generation: { provider: "p", model: "m" },
    });
  });

  it("matches exact names and wildcard groups", () => {
    assert.equal(matchesPattern("mcp__github__issue", "mcp__*"), true);
    assert.equal(matchesPattern("read", "read"), true);
    assert.equal(matchesPattern("grep", "read"), false);
    assert.equal(matchesPattern("web_fetch", "web_*"), true);
    assert.equal(matchesPattern("web-fetch", "web_*"), false);
  });

  it("resolves group membership and hidden union", () => {
    const policy = {
      disabled: ["web_fetch"],
      groups: [{ name: "mcp", patterns: ["mcp__*"] }],
    };
    const names = ["read", "web_fetch", "mcp__git__status", "mcp__db__query"];
    assert.deepEqual(resolveGroups(policy, names)[0]?.tools, [
      "mcp__git__status",
      "mcp__db__query",
    ]);
    assert.deepEqual([...hiddenTools(policy, names)], [
      "web_fetch",
      "mcp__git__status",
      "mcp__db__query",
    ]);
  });

  it("keeps exposed group tools visible unless explicitly disabled", () => {
    const policy = {
      disabled: ["mcp__git__status"],
      groups: [{ name: "mcp", patterns: ["mcp__*"] }],
    };
    const names = ["read", "web_fetch", "mcp__git__status", "mcp__db__query"];
    assert.deepEqual(denyNames(policy, names, new Set(["mcp"])), [
      "mcp__git__status",
    ]);
    assert.deepEqual(denyNames(policy, names, new Set()), [
      "mcp__git__status",
      "mcp__db__query",
    ]);
  });

  it("never denies discovery or PTC transport even if a policy names them", () => {
    const policy = {
      disabled: ["tool_list", "run_code", "read"],
      groups: [{ name: "all", patterns: ["*"] }],
    };
    assert.deepEqual(denyNames(policy, ["read", "tool_list", "run_code", "write"], new Set()), [
      "read",
      "write",
    ]);
  });

  it("hides globally registered tool_list when a preset has no active groups", () => {
    assert.deepEqual(denyNames(
      { disabled: [], groups: [] },
      ["read", "tool_list", "write"],
      new Set(),
    ), ["tool_list"]);
    assert.deepEqual(denyNames(
      { disabled: [], groups: [{ name: "empty", patterns: ["gone"] }] },
      ["read", "tool_list", "write"],
      new Set(),
    ), ["tool_list"]);
  });

  it("keeps empty groups visible as invalid configuration", () => {
    const policy = {
      disabled: ["gone", "read"],
      groups: [{ name: "mcp", patterns: [] }],
    };
    assert.deepEqual(policyOrphans(policy, ["read", "write"]), {
      disabled: ["gone"],
      emptyGroups: ["mcp"],
    });
  });

  it("marks opened groups without listing tools", () => {
    const groups = [{
      name: "GitHub MCP",
      description: "GitHub tools",
      patterns: ["mcp__*"],
      tools: Array.from({ length: 30 }, (_, i) => `mcp__s__t${i}`),
    }];
    const listed = listGroupViews(groups, new Set(["GitHub MCP"]));
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.name, "GitHub MCP");
    assert.equal(listed[0]?.description, "GitHub tools");
    assert.equal(listed[0]?.exposed, true);
  });

  it("resolves only non-empty active groups and excludes discovery transports", () => {
    const policy = {
      disabled: [],
      groups: [
        { name: "all", patterns: ["*"] },
        { name: "empty", patterns: ["gone"] },
      ],
    };
    assert.deepEqual(resolveActiveGroups(
      policy,
      ["read", "tool_list", "run_code"],
    ).map((group) => ({ name: group.name, tools: group.tools })), [
      { name: "all", tools: ["read"] },
    ]);
    assert.deepEqual(resolveActiveGroups(
      { disabled: ["read"], groups: [{ name: "disabled only", patterns: ["read"] }] },
      ["read", "tool_list"],
    ), []);
  });

  it("assigns overlapping tools to the first group and reports policy conflicts", () => {
    const policy = {
      disabled: ["web_fetch"],
      groups: [
        { name: "Web", patterns: ["web_*"] },
        { name: "Search", patterns: ["web_search"] },
        { name: "Fetch", patterns: ["web_fetch"] },
      ],
    };
    assert.deepEqual(resolveActiveGroups(policy, ["web_search", "web_fetch"])
      .map((group) => ({ name: group.name, tools: group.tools })), [
      { name: "Web", tools: ["web_search"] },
    ]);
    assert.deepEqual(groupPolicyIssues(policy, ["web_search", "web_fetch"]), {
      emptyGroups: ["Fetch"],
      disabledMembers: [{ tool: "web_fetch", groups: ["Web"] }, { tool: "web_fetch", groups: ["Fetch"] }],
      duplicateMembers: [
        { tool: "web_search", groups: ["Web", "Search"] },
        { tool: "web_fetch", groups: ["Web", "Fetch"] },
      ],
    });
  });

  it("finds a group by name case-insensitively", () => {
    const groups = [{ name: "GitHub MCP", patterns: [], tools: ["mcp__a"] }];
    assert.equal(findGroup(groups, " github mcp ")?.name, "GitHub MCP");
    assert.equal(findGroup(groups, "other"), undefined);
  });

  it("normalizes group names without truncating or ascii-slugifying", () => {
    const longName = `搜索工具${"长".repeat(200)}`;
    assert.equal(normalizeGroupName(" GitHub MCP "), "GitHub MCP");
    assert.equal(normalizeGroupName("搜索工具"), "搜索工具");
    assert.equal(normalizeGroupName(`  ${longName}  `), longName);
  });

  it("parses restrict() unknown-name diagnostics", () => {
    const error = new Error('tools.restrict() names unknown global tool "gone"; known global tools: read, write');
    assert.deepEqual([...(parseKnownRestrictable(error) ?? [])], ["read", "write"]);
    assert.equal(parseKnownRestrictable(new Error("boom")), undefined);
  });

  it("drops the inert mcp.expose field and keeps the mode", () => {
    assert.deepEqual(normalizeSettings({
      presets: {
        standard: {
          disabled: [],
          groups: [{ name: "Web", patterns: ["web_*"] }],
          mode: "mcp",
          mcp: { expose: ["read", "read", "grep", 7] },
        },
      },
    }), {
      presets: {
        standard: {
          disabled: [],
          groups: [{ name: "Web", patterns: ["web_*"] }],
          mode: "mcp",
        },
      },
    });
  });

  it("no longer force-hides the retired tool_open name", () => {
    assert.deepEqual(denyNames(
      { disabled: [], groups: [] },
      ["read", "tool_open"],
      new Set(),
    ), []);
  });
});

describe("compaction keep limit", () => {
  it("keeps a non-negative whole count and drops everything else", () => {
    const kept = normalizeSettings({
      presets: {
        standard: { disabled: [], groups: [], keepAfterCompaction: 0 },
        minimal: { disabled: [], groups: [], keepAfterCompaction: 3 },
      },
    });
    assert.deepEqual(kept, {
      presets: {
        standard: { disabled: [], groups: [], keepAfterCompaction: 0 },
        minimal: { disabled: [], groups: [], keepAfterCompaction: 3 },
      },
    });

    for (const bad of [-1, 1.5, "3", null, {}, Number.NaN, Number.POSITIVE_INFINITY, true]) {
      assert.deepEqual(
        normalizeSettings({ presets: { standard: { disabled: [], groups: [], keepAfterCompaction: bad } } }),
        { presets: { standard: { disabled: [], groups: [] } } },
      );
    }

    // An older config without the key keeps working and stays clean.
    assert.deepEqual(normalizeSettings({ presets: { standard: { disabled: [], groups: [] } } }), {
      presets: { standard: { disabled: [], groups: [] } },
    });
  });
});
