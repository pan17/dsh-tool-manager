import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { assertNoEmptyGroups } from "../dist/index.js";

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
const plain = (value) => JSON.parse(JSON.stringify(value));

function preset(id, toolNames, policy) {
  return {
    id,
    tools: toolNames.map((name) => ({ name, description: name + " description", parameters: {} })),
    policy,
  };
}

describe("copyPresetPolicy", () => {
  it("copies groups and disabled names, pruning to the target catalog", () => {
    const source = preset("standard", ["alpha", "beta", "gamma", "delta"], {
      disabled: ["delta", "missing"],
      groups: [
        { name: "组一", description: "第一组", patterns: ["alpha", "beta", "missing"] },
        { name: "组二", patterns: ["beta", "gamma"] },
        { name: "组三", patterns: ["missing"] },
      ],
    });
    const target = preset("minimal", ["alpha", "beta", "gamma", "extra"], {
      disabled: ["extra"],
      groups: [{ name: "旧组", patterns: ["extra"] }],
    });

    assert.deepEqual(plain(client.copyPresetPolicy(source, target)), {
      disabled: [],
      groups: [
        { name: "组一", description: "第一组", patterns: ["alpha", "beta"] },
        { name: "组二", patterns: ["gamma"] },
      ],
      skippedGroups: ["组三"],
    });
  });

  it("expands wildcard groups to exact target members", () => {
    const source = preset("standard", ["mcp__a", "mcp__b"], {
      disabled: [],
      groups: [{ name: "MCP", patterns: ["mcp__*"] }],
    });
    const target = preset("minimal", ["mcp__b", "mcp__c"], { disabled: [], groups: [] });

    assert.deepEqual(plain(client.copyPresetPolicy(source, target).groups), [
      { name: "MCP", patterns: ["mcp__b"] },
    ]);
  });

  it("never puts a disabled tool into a copied group", () => {
    const source = preset("standard", ["alpha", "beta"], {
      disabled: ["beta"],
      groups: [{ name: "组", patterns: ["alpha", "beta"] }],
    });
    const target = preset("minimal", ["alpha", "beta"], { disabled: [], groups: [] });

    assert.deepEqual(plain(client.copyPresetPolicy(source, target)), {
      disabled: ["beta"],
      groups: [{ name: "组", patterns: ["alpha"] }],
      skippedGroups: [],
    });
  });

  it("deduplicates overlapping source groups in first-match order", () => {
    const source = preset("standard", ["alpha", "beta", "gamma"], {
      disabled: [],
      groups: [
        { name: "第一组", patterns: ["alpha", "beta"] },
        { name: "第二组", patterns: ["beta", "gamma"] },
      ],
    });
    const target = preset("minimal", ["alpha", "beta", "gamma"], { disabled: [], groups: [] });

    assert.deepEqual(plain(client.copyPresetPolicy(source, target).groups), [
      { name: "第一组", patterns: ["alpha", "beta"] },
      { name: "第二组", patterns: ["gamma"] },
    ]);
  });

  it("produces a policy accepted by the save validator", async () => {
    const source = preset("standard", ["alpha", "beta", "gamma", "delta"], {
      disabled: ["delta"],
      groups: [
        { name: "组一", patterns: ["alpha", "beta"] },
        { name: "组二", patterns: ["beta", "gamma"] },
      ],
    });
    const target = preset("minimal", ["alpha", "beta", "gamma", "extra"], { disabled: [], groups: [] });
    const copied = client.copyPresetPolicy(source, target);

    await assertNoEmptyGroups(
      { compositionInventory: async () => [{ id: "minimal", isDefault: false }] },
      {},
      { presets: { minimal: copied } },
      undefined,
      () => target.tools.map((tool) => tool.name),
    );
  });
});
