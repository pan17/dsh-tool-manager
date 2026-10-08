import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DefaultPresetMount,
  PresetSchemaProbe,
  assertNoEmptyGroups,
  createPresetCatalog,
  visiblePresetToolNames,
} from "../dist/index.js";

const STANDING = ["read", "web_search", "web_fetch"];
/** Registered by `@deepseek-ai/dsh-schedule` into each ROOT Agent's own scope. */
const AGENT_SCOPED = ["schedule_create", "schedule_list", "schedule_delete", "schedule_update"];

function schema(name) {
  return { name, description: `${name} description`, parameters: {} };
}

/**
 * Reproduces the real registration split:
 * - `acquireScope()` (the Preset's standing composition) never sees the
 *   Schedule tools;
 * - a ROOT Agent's own scope does, because `dsh-schedule` attaches them to
 *   `agent.ctx` for every `agents.roots()` entry;
 * - the plugin's own probe Session is created with `origin: "subagent"`, so it
 *   is NOT a root and does NOT receive them. It is nevertheless a live
 *   `standard` Agent, which is what `livePresetSchemas` finds first.
 */
function harness() {
  const scoped = new Map();
  const agents = {
    list() {
      return [...scoped.keys()];
    },
    async create(options) {
      const subagent = options.meta?.origin === "subagent";
      const agentCtx = {
        presetId: options.meta?.agentPreset ?? "standard",
        get(name) {
          return name === "tools" ? tools : undefined;
        },
      };
      const agent = { id: options.sessionId, ctx: agentCtx, session: undefined };
      scoped.set(agent, subagent ? [...STANDING] : [...STANDING, ...AGENT_SCOPED]);
      await options.setup?.(agentCtx, agent);
      return { agent, async dispose() {} };
    },
    async resume(options) {
      return this.create({ sessionId: options.resumeSessionId, setup: options.setup });
    },
    roots() {
      return [...scoped.keys()].filter((agent) => agent.id !== "tool-manager-probe-internal-v1");
    },
  };

  const tools = {
    schemas(scope) {
      if (scope === undefined) return STANDING.map(schema);
      return (scoped.get(scope) ?? STANDING).map(schema);
    },
    register() {
      return () => {};
    },
    restrict() {
      return () => {};
    },
  };

  const presets = {
    async compositionInventory() {
      return [{ id: "standard", isDefault: true, trust: "system" }];
    },
    async acquireScope() {
      return { key: undefined, async [Symbol.asyncDispose]() {} };
    },
    composedPreset(agentCtx) {
      return agentCtx.presetId;
    },
    async mount() {},
    async recompose(agentCtx, id) {
      agentCtx.presetId = id;
    },
  };

  const context = {
    get(name) {
      if (name === "agents") return agents;
      if (name === "sessionPersistence") return { async stat() { return undefined; } };
      if (name === "tools") return tools;
      if (name === "logger") return { warn() {}, info() {} };
      return undefined;
    },
    on() {
      return () => {};
    },
  };

  const probe = new PresetSchemaProbe(context, presets);
  const defaultPreset = new DefaultPresetMount(presets, () => {});
  const catalog = createPresetCatalog({
    context,
    presets,
    probe,
    defaultPreset,
    // What `ToolPolicyRuntime.observedSchemasFor` reports: the union of every
    // live ROOT Agent's own scope, which is where the Schedule tools live.
    observed: (presetId) => presetId === "standard"
      ? AGENT_SCOPED.map(schema)
      : [],
  });

  return { context, presets, tools, probe, defaultPreset, catalog, agents, scoped };
}

const settings = {
  presets: {
    standard: {
      disabled: [],
      groups: [{ name: "定时提醒管理", patterns: [...AGENT_SCOPED] }],
    },
  },
};

const validate = (harness, next = settings) => assertNoEmptyGroups(
  harness.presets,
  harness.tools,
  next,
  () => harness.defaultPreset.ensure(),
  (presetId) => visiblePresetToolNames(harness.presets, harness.tools, harness.catalog, presetId),
);

describe("save validation reads the same catalog as the page", () => {
  it("rejects the group when validation reads only the standing composition", async () => {
    const { presets, tools } = harness();
    await assert.rejects(
      () => assertNoEmptyGroups(presets, tools, settings, () => Promise.resolve()),
      /empty tool groups: "定时提醒管理"/,
    );
  });

  it("accepts the group through the merged page catalog", async () => {
    const h = harness();
    // Materialize the probe first, exactly as the settings page does, so the
    // subagent probe is the live `standard` Agent the catalog samples.
    await h.probe.inspect("standard");
    await validate(h);
  });

  it("merges standing and observed names exactly once each", async () => {
    const h = harness();
    await h.probe.inspect("standard");
    const names = await visiblePresetToolNames(h.presets, h.tools, h.catalog, "standard");
    assert.deepEqual(names, [...STANDING, ...AGENT_SCOPED]);
    assert.equal(new Set(names).size, names.length);
  });

  it("still reports a genuinely absent tool as an empty group", async () => {
    const h = harness();
    await h.probe.inspect("standard");
    await assert.rejects(
      () => validate(h, {
        presets: {
          standard: { disabled: [], groups: [{ name: "不存在", patterns: ["codex_image_generate"] }] },
        },
      }),
      /empty tool groups: "不存在"/,
    );
  });

  it("skips a preset whose standing composition cannot be read", async () => {
    const h = harness();
    await h.probe.inspect("standard");
    const broken = {
      schemas() {
        throw new Error("unavailable");
      },
    };
    await assertNoEmptyGroups(
      h.presets,
      broken,
      settings,
      () => h.defaultPreset.ensure(),
      (presetId) => visiblePresetToolNames(h.presets, broken, h.catalog, presetId),
    );
  });
});
