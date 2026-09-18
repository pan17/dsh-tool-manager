import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply, createPresetCatalog, DefaultPresetMount } from "../dist/index.js";
import { policyOrphans } from "../dist/policy.js";

// The plugin reads its policy store on load; keep that read away from the
// developer's real configuration.
process.env.DSH_TOOL_MANAGER_CONFIG = join(tmpdir(), "dsh-tool-manager-absent-test-config.json");

function schema(name) {
  return { name, description: name, parameters: {} };
}

function pluginContext({ mounted, warnings }) {
  return {
    get(name) {
      if (name === "agentPresets") {
        return {
          composedPreset: () => undefined,
          async compositionInventory() {
            return [];
          },
          async standingKeyFor(id) {
            mounted.push(id);
            return { agentPreset: "standard" };
          },
          async mount() {},
          async recompose() {},
        };
      }
      if (name === "tools") {
        return {
          schemas: () => [],
          register: () => () => {},
          restrict: () => () => {},
        };
      }
      if (name === "agents") return { list: () => [] };
      if (name === "logger") {
        return { warn: (message) => warnings.push(message) };
      }
      return undefined;
    },
    on() {
      return () => {};
    },
  };
}

describe("session default preset composition order", () => {
  it("composes the default through the unresolved preset id", async () => {
    const ids = [];
    const presets = {
      async standingKeyFor(id) {
        ids.push(id);
        return { agentPreset: "standard" };
      },
    };
    const mount = new DefaultPresetMount(presets, () => {});

    await mount.ensure();

    assert.deepEqual(ids, [undefined]);
  });

  it("composes the default once for concurrent and repeated callers", async () => {
    let calls = 0;
    const presets = {
      async standingKeyFor() {
        calls += 1;
        return {};
      },
    };
    const mount = new DefaultPresetMount(presets, () => {});

    await Promise.all([mount.ensure(), mount.ensure()]);
    await mount.ensure();

    assert.equal(calls, 1);
  });

  it("warns instead of failing, then retries a failed composition", async () => {
    const warnings = [];
    let calls = 0;
    const presets = {
      async standingKeyFor() {
        calls += 1;
        if (calls === 1) throw new Error("default preset is broken");
        return {};
      },
    };
    const mount = new DefaultPresetMount(presets, (message) => warnings.push(message));

    await mount.ensure();
    assert.equal(calls, 1);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /could not compose the default agent preset/);
    assert.match(warnings[0], /default preset is broken/);

    await mount.ensure();
    assert.equal(calls, 2);

    await mount.ensure();
    assert.equal(calls, 2);
  });

  it("composes the default before probing any cold preset", async () => {
    const order = [];
    const presets = {
      composedPreset: () => undefined,
      async standingKeyFor(id) {
        order.push(`compose:${id ?? "<default>"}`);
        return id;
      },
      async compositionInventory() {
        return [
          { id: "standard", trust: "system", isDefault: true },
          { id: "cordis", trust: "system", isDefault: false },
        ];
      },
    };
    const probe = {
      async inspect(presetId) {
        order.push(`probe:${presetId}`);
        return [schema(`${presetId}-tool`)];
      },
    };
    const mount = new DefaultPresetMount(presets, () => {});
    const catalog = createPresetCatalog({
      context: { get: () => undefined },
      presets,
      probe,
      defaultPreset: mount,
      observed: () => [],
    });

    await catalog.ensureAll();

    assert.equal(order[0], "compose:<default>");
    assert.deepEqual(
      order.filter((entry) => entry.startsWith("probe:")),
      ["probe:standard", "probe:cordis"],
    );
    assert.deepEqual(catalog.schemasFor("cordis").map((item) => item.name), ["cordis-tool"]);
  });

  it("answers a preset with a live agent without composing or probing", async () => {
    const live = { schemas: () => [schema("pwsh")] };
    const agent = {
      ctx: {
        get(name) {
          return name === "tools" ? live : undefined;
        },
      },
    };
    const presets = {
      composedPreset: () => "standard",
      async standingKeyFor() {
        throw new Error("must not compose for a live preset");
      },
      async compositionInventory() {
        return [{ id: "standard", trust: "system", isDefault: true }];
      },
    };
    const probe = {
      async inspect() {
        throw new Error("must not probe a live preset");
      },
    };
    const mount = new DefaultPresetMount(presets, () => {});
    const catalog = createPresetCatalog({
      context: {
        get(name) {
          return name === "agents" ? { list: () => [agent] } : undefined;
        },
      },
      presets,
      probe,
      defaultPreset: mount,
      observed: (presetId) => (presetId === "standard" ? [schema("pwsh")] : []),
    });

    await catalog.ensureAll();

    assert.deepEqual(catalog.schemasFor("standard").map((item) => item.name), ["pwsh"]);
  });

  it("keeps the live catalog stable across a transient scoped-tool gap", async () => {
    let liveSchemas = [
      schema("pwsh"),
      { ...schema("subagent"), description: "first delegation schema" },
      schema("list_subagent_models"),
    ];
    const live = { schemas: () => liveSchemas };
    const agent = {
      ctx: {
        get(name) {
          return name === "tools" ? live : undefined;
        },
      },
    };
    const presets = {
      composedPreset: () => "standard",
      async compositionInventory() {
        return [{ id: "standard", trust: "system", isDefault: true }];
      },
    };
    const catalog = createPresetCatalog({
      context: {
        get(name) {
          return name === "agents" ? { list: () => [agent] } : undefined;
        },
      },
      presets,
      probe: { inspect: async () => { throw new Error("must not probe a live preset"); } },
      defaultPreset: new DefaultPresetMount({
        standingKeyFor: async () => { throw new Error("must not compose for a live preset"); },
      }, () => {}),
      observed: () => [],
    });

    await catalog.ensureAll();
    assert.deepEqual(catalog.schemasFor("standard").map((item) => item.name), [
      "pwsh",
      "subagent",
      "list_subagent_models",
    ]);

    liveSchemas = [schema("pwsh")];
    await catalog.ensureAll();
    const duringGap = catalog.schemasFor("standard");
    assert.deepEqual(duringGap.map((item) => item.name), [
      "pwsh",
      "subagent",
      "list_subagent_models",
    ]);
    assert.deepEqual(
      policyOrphans(
        { disabled: ["subagent", "list_subagent_models"], groups: [] },
        duringGap.map((item) => item.name),
      ).disabled,
      [],
    );

    liveSchemas = [
      schema("pwsh"),
      { ...schema("subagent"), description: "updated delegation schema" },
      schema("list_subagent_models"),
      schema("new_dynamic_tool"),
    ];
    await catalog.ensureAll();
    const stable = catalog.schemasFor("standard");
    assert.deepEqual(stable.map((item) => item.name), [
      "pwsh",
      "subagent",
      "list_subagent_models",
      "new_dynamic_tool",
    ]);
    assert.equal(stable.find((item) => item.name === "subagent").description, "updated delegation schema");
  });

  it("composes the default as soon as the plugin loads, before any page request", async () => {
    const mounted = [];
    const warnings = [];

    apply(pluginContext({ mounted, warnings }));
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(mounted, [undefined]);
    assert.deepEqual(warnings, []);
  });
});
