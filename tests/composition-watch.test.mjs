import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply, CompositionWatch, isBlankSession } from "../dist/index.js";

// The plugin reads its policy store on load; keep that read away from the
// developer's real configuration.
process.env.DSH_TOOL_MANAGER_CONFIG = join(tmpdir(), "dsh-tool-manager-absent-test-config.json");

function schema(name) {
  return { name, description: name, parameters: {} };
}

const INVENTORY = [
  {
    id: "standard",
    trust: "system",
    isDefault: true,
    rows: [{ moduleName: "a" }, { moduleName: "b" }, { moduleName: "c" }],
  },
  {
    id: "cordis",
    trust: "system",
    isDefault: false,
    rows: [{ moduleName: "a" }, { moduleName: "b" }, { moduleName: "c" }, { moduleName: "d" }],
  },
  { id: "minimal", trust: "system", isDefault: false, rows: [{ moduleName: "a" }] },
];

function sessionOf(types) {
  const events = new Map(types.map((type, index) => [index + 1, { type }]));
  return { seq: types.length, eventAt: (seq) => events.get(seq) };
}

function blankSession() {
  return sessionOf(["session", "sandbox/mode"]);
}

function startedSession() {
  return sessionOf(["session", "turn/start", "step/start"]);
}

function fakeAgent({ id = "s1", preset = "standard", names = ["read"], session = blankSession() } = {}) {
  return {
    id,
    session,
    names: [...names],
    ctx: { preset, get: () => undefined },
  };
}

function fakePresets({ calls = [], inventory = INVENTORY, onRecompose } = {}) {
  return {
    composedPreset: (ctx) => ctx.preset,
    async compositionInventory() {
      return inventory;
    },
    async recompose(ctx, id) {
      if (onRecompose) await onRecompose(id, ctx);
      calls.push(id);
      ctx.preset = id;
    },
    async standingKeyFor() {
      return {};
    },
    async mount() {},
  };
}

function watchFor({ agents, presets, tools, probe, explainedLoss, excludeAgentId } = {}) {
  const warnings = [];
  const infos = [];
  const listeners = new Map();
  const watch = new CompositionWatch({
    presets,
    agents: () => agents,
    tools: () => tools ?? { schemas: (agent) => agent.names.map(schema) },
    probe,
    explainedLoss,
    excludeAgentId,
    warn: (message) => warnings.push(message),
    info: (message) => infos.push(message),
    debounceMs: 1,
    settle: async () => {},
  });
  watch.start({
    on(event, listener) {
      listeners.set(event, listener);
      return () => {};
    },
  });
  return { watch, warnings, infos, listeners };
}

describe("CompositionWatch", () => {
  it("re-calibrates a Session through the smallest other preset after a mode switch", async () => {
    const agent = fakeAgent({ preset: "standard" });
    const calls = [];
    const { watch } = watchFor({ agents: [agent], presets: fakePresets({ calls }) });

    await watch.flush(); // baseline: the Session is on "standard"
    agent.ctx.preset = "cordis"; // the mode picker re-linked it
    await watch.flush();

    assert.deepEqual(calls, ["minimal", "cordis"]);
    assert.equal(agent.ctx.preset, "cordis");
  });

  it("leaves a Session that did not switch alone", async () => {
    const agent = fakeAgent({ preset: "cordis" });
    const calls = [];
    const { watch } = watchFor({ agents: [agent], presets: fakePresets({ calls }) });

    await watch.flush();
    await watch.flush();

    assert.deepEqual(calls, []);
  });

  it("runs one re-calibration for repeated change events", async () => {
    const agent = fakeAgent({ preset: "standard" });
    const calls = [];
    const { watch, listeners } = watchFor({ agents: [agent], presets: fakePresets({ calls }) });

    await watch.flush();
    agent.ctx.preset = "cordis";
    listeners.get("tools/change")();
    listeners.get("tools/change")();
    await watch.flush();

    assert.deepEqual(calls, ["minimal", "cordis"]);
  });

  it("reports the tools a re-calibration brought back", async () => {
    const agent = fakeAgent({ preset: "standard", names: ["read"] });
    const calls = [];
    const presets = fakePresets({
      calls,
      // The switch to "cordis" lost its per-Agent tools; the round trip
      // restores them while the transit preset is composed.
      onRecompose: async (id) => {
        if (id === "cordis") agent.names = ["read", "subagent", "list_subagent_models"];
      },
    });
    const { watch, infos, warnings } = watchFor({ agents: [agent], presets });

    await watch.flush();
    agent.ctx.preset = "cordis";
    await watch.flush();

    assert.deepEqual(warnings, []);
    assert.equal(infos.length, 1);
    assert.match(infos[0], /lost 2 tool\(s\) on the switch to preset "cordis"/);
    assert.match(infos[0], /list_subagent_models, subagent/);
    assert.match(infos[0], /re-calibration restored them/);
  });

  it("never re-links a Session that already started a turn, and names what it is short of", async () => {
    const agent = fakeAgent({ preset: "standard", session: startedSession(), names: ["read"] });
    const calls = [];
    const { watch, warnings } = watchFor({
      agents: [agent],
      presets: fakePresets({ calls }),
      probe: async () => [schema("read"), schema("subagent")],
    });

    await watch.flush();
    agent.ctx.preset = "cordis";
    await watch.flush();

    assert.deepEqual(calls, []);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /already started, so DSH keeps its preset fixed/);
    assert.match(warnings[0], /subagent/);
  });

  it("stays quiet about a started Session that holds everything its preset provides", async () => {
    const agent = fakeAgent({ preset: "standard", session: startedSession(), names: ["read"] });
    const { watch, warnings } = watchFor({
      agents: [agent],
      presets: fakePresets(),
      probe: async () => [schema("read")],
    });

    await watch.flush();
    agent.ctx.preset = "cordis";
    await watch.flush();

    assert.deepEqual(warnings, []);
  });

  it("restores the intended preset when a leg fails", async () => {
    const agent = fakeAgent({ preset: "standard" });
    const calls = [];
    const presets = fakePresets({
      calls,
      onRecompose: async (id) => {
        if (id === "minimal") throw new Error("transit preset is broken");
      },
    });
    const { watch, warnings } = watchFor({ agents: [agent], presets });

    await watch.flush();
    agent.ctx.preset = "cordis";
    await watch.flush();

    assert.deepEqual(calls, ["cordis"]);
    assert.equal(agent.ctx.preset, "cordis");
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /could not be re-calibrated through preset "minimal"/);
    assert.match(warnings[0], /transit preset is broken/);
  });

  it("hands the Session to a newer switch instead of forcing its first target", async () => {
    const agent = fakeAgent({ preset: "standard" });
    const calls = [];
    const warnings = [];
    const infos = [];
    let settles = 0;
    const watch = new CompositionWatch({
      presets: fakePresets({ calls }),
      agents: () => [agent],
      tools: () => ({ schemas: (scope) => scope.names.map(schema) }),
      warn: (message) => warnings.push(message),
      info: (message) => infos.push(message),
      debounceMs: 1,
      // The user picks another mode while the Session is on the transit preset.
      settle: async () => {
        settles += 1;
        if (settles === 1) agent.ctx.preset = "ptc";
      },
    });
    watch.start({ on: () => () => {} });

    await watch.flush();
    agent.ctx.preset = "cordis";
    await watch.flush();

    assert.deepEqual(calls, ["minimal", "minimal", "ptc"]);
    assert.equal(agent.ctx.preset, "ptc");
    assert.deepEqual(warnings, []);
  });

  it("warns when no other preset can serve as the transit", async () => {
    const agent = fakeAgent({ preset: "standard" });
    const { watch, warnings } = watchFor({
      agents: [agent],
      // The Session's own preset turned unusable, so nothing is left to
      // re-calibrate it through.
      presets: fakePresets({
        inventory: [
          { id: "standard", trust: "system", isDefault: true, broken: "composition is unusable" },
          { id: "cordis", trust: "system", isDefault: false, rows: [{ moduleName: "a" }] },
        ],
      }),
    });

    await watch.flush();
    agent.ctx.preset = "cordis";
    await watch.flush();

    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /no other usable preset/);
  });

  it("warns about a loss with no switch when the reference Agent still provides the tool", async () => {
    const agent = fakeAgent({ preset: "cordis", names: ["read", "subagent"] });
    const { watch, warnings } = watchFor({
      agents: [agent],
      presets: fakePresets(),
      probe: async () => [schema("read"), schema("subagent")],
    });

    await watch.flush();
    agent.names = ["read"];
    await watch.flush();

    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /lost 1 tool\(s\)/);
    assert.match(warnings[0], /subagent/);
    assert.match(warnings[0], /reopen the Session/);
  });

  it("stays quiet when the reference Agent lacks the name too", async () => {
    const agent = fakeAgent({ preset: "cordis", names: ["read", "subagent_codex"] });
    const { watch, warnings } = watchFor({
      agents: [agent],
      presets: fakePresets(),
      probe: async () => [schema("read")],
    });

    await watch.flush();
    agent.names = ["read"];
    await watch.flush();

    assert.deepEqual(warnings, []);
  });

  it("stays quiet when the plugin's own policy explains the loss", async () => {
    const agent = fakeAgent({ preset: "cordis", names: ["read", "anysearch_search"] });
    const { watch, warnings } = watchFor({
      agents: [agent],
      presets: fakePresets(),
      probe: async () => [schema("read"), schema("anysearch_search")],
      explainedLoss: (_preset, name) => name === "anysearch_search",
    });

    await watch.flush();
    agent.names = ["read"];
    await watch.flush();

    assert.deepEqual(warnings, []);
  });

  it("ignores the plugin's own probe Session", async () => {
    const agent = fakeAgent({ id: "tool-manager-probe", preset: "standard" });
    const calls = [];
    const { watch } = watchFor({
      agents: [agent],
      presets: fakePresets({ calls }),
      excludeAgentId: "tool-manager-probe",
    });

    await watch.flush();
    agent.ctx.preset = "cordis";
    await watch.flush();

    assert.deepEqual(calls, []);
  });

  it("subscribes to the events that can change an Agent's tool set", () => {
    const { listeners } = watchFor({ agents: [], presets: fakePresets() });

    assert.deepEqual([...listeners.keys()].sort(), ["agent/disposed", "tools/change"]);
  });

  it("forgets an Agent that was disposed", async () => {
    const agent = fakeAgent({ preset: "standard" });
    const calls = [];
    const { watch, listeners } = watchFor({ agents: [agent], presets: fakePresets({ calls }) });

    await watch.flush();
    listeners.get("agent/disposed")({ agent });
    agent.ctx.preset = "cordis";
    await watch.flush();

    assert.deepEqual(calls, []);
  });
});

describe("isBlankSession", () => {
  it("accepts a Session with no turn in it", () => {
    assert.equal(isBlankSession(blankSession()), true);
  });

  it("refuses a Session that started a turn", () => {
    assert.equal(isBlankSession(startedSession()), false);
  });

  it("refuses a Session with inherited fork history", () => {
    assert.equal(isBlankSession({ seq: 2, inheritedEventCount: 1, eventAt: () => ({ type: "session" }) }), false);
  });

  it("refuses a long transcript without scanning it", () => {
    assert.equal(isBlankSession({ seq: 5000, eventAt: () => ({ type: "session" }) }), false);
  });

  it("refuses a Session it cannot read", () => {
    assert.equal(isBlankSession(undefined), false);
  });
});

describe("plugin wiring", () => {
  it("re-calibrates a switch that happens while the plugin is loaded", async () => {
    const agent = fakeAgent({ preset: "standard", names: ["read"] });
    const calls = [];
    const listeners = new Map();
    apply({
      get(name) {
        if (name === "agentPresets") {
          return {
            composedPreset: (ctx) => ctx.preset,
            async compositionInventory() {
              return INVENTORY;
            },
            async standingKeyFor() {
              return {};
            },
            async mount() {},
            async recompose(ctx, id) {
              calls.push(id);
              ctx.preset = id;
            },
          };
        }
        if (name === "tools") {
          return {
            schemas: (scope) => (Array.isArray(scope?.names) ? scope.names.map(schema) : []),
            register: () => () => {},
            restrict: () => () => {},
          };
        }
        if (name === "agents") return { list: () => [agent] };
        return undefined;
      },
      on(event, listener) {
        const bucket = listeners.get(event) ?? [];
        bucket.push(listener);
        listeners.set(event, bucket);
        return () => {};
      },
      effect() {
        return () => {};
      },
    });

    // The plugin takes its first look at the live Session, then the mode picker
    // re-links it.
    await new Promise((resolve) => setTimeout(resolve, 200));
    agent.ctx.preset = "cordis";
    for (const listener of listeners.get("tools/change") ?? []) {
      try {
        listener();
      } catch {
        // Another subscriber's business, not this test's.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 300));

    assert.deepEqual(calls, ["minimal", "cordis"]);
    assert.equal(agent.ctx.preset, "cordis");
  });
});
