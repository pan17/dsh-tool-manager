import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PresetSchemaProbe,
  TOOL_MANAGER_PROBE_SESSION_ID,
} from "../dist/index.js";

function schema(name) {
  return { name, description: name, parameters: {} };
}

function harness(options = {}) {
  const calls = {
    create: [],
    resume: [],
    mount: [],
    recompose: [],
    dispose: 0,
  };
  let currentPreset;
  let active = 0;
  let maxActive = 0;
  const agent = {
    id: TOOL_MANAGER_PROBE_SESSION_ID,
    ctx: {
      get(name) {
        if (name !== "tools") return undefined;
        return {
          schemas() {
            return [schema(`tool-${currentPreset}`)];
          },
        };
      },
      on() {},
    },
  };
  const handle = {
    agent,
    async dispose() {
      calls.dispose += 1;
    },
  };
  const presets = {
    composedPreset() {
      return currentPreset;
    },
    async mount(_ctx, id) {
      calls.mount.push(id);
      currentPreset = id;
    },
    async recompose(_ctx, id) {
      calls.recompose.push(id);
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (options.recomposeGate) await options.recomposeGate(id);
      currentPreset = id;
      active -= 1;
    },
  };
  const agents = {
    list() {
      return [];
    },
    async create(request) {
      calls.create.push(request);
      await request.setup?.(agent.ctx, agent);
      return handle;
    },
    async resume(request) {
      calls.resume.push(request);
      if (options.resumeError) throw options.resumeError;
      await request.setup?.(agent.ctx, agent);
      return handle;
    },
  };
  const persistence = {
    async stat(id) {
      assert.equal(id, TOOL_MANAGER_PROBE_SESSION_ID);
      return options.persisted ? { header: { id } } : undefined;
    },
  };
  const context = {
    get(name) {
      if (name === "agents") return agents;
      if (name === "sessionPersistence") return persistence;
      return undefined;
    },
    on() {},
  };
  return {
    probe: new PresetSchemaProbe(context, presets),
    calls,
    get maxActive() {
      return maxActive;
    },
  };
}

describe("single persistent Preset schema probe", () => {
  it("creates one fixed hidden Session and reuses it across Presets", async () => {
    const h = harness();

    assert.deepEqual((await h.probe.inspect("standard")).map((item) => item.name), ["tool-standard"]);
    assert.deepEqual((await h.probe.inspect("cordis")).map((item) => item.name), ["tool-cordis"]);
    assert.deepEqual((await h.probe.inspect("standard")).map((item) => item.name), ["tool-standard"]);

    assert.equal(h.calls.create.length, 1);
    assert.equal(h.calls.resume.length, 0);
    assert.equal(h.calls.create[0].sessionId, TOOL_MANAGER_PROBE_SESSION_ID);
    assert.deepEqual(h.calls.create[0].meta, {
      agentPreset: "standard",
      origin: "subagent",
    });
    assert.deepEqual(h.calls.mount, ["standard"]);
    assert.deepEqual(h.calls.recompose, ["cordis", "standard"]);

    await h.probe.dispose();
    assert.equal(h.calls.dispose, 1);
  });

  it("resumes the same fixed Session after restart instead of creating another", async () => {
    const h = harness({ persisted: true });

    assert.deepEqual((await h.probe.inspect("minimal")).map((item) => item.name), ["tool-minimal"]);
    assert.equal(h.calls.create.length, 0);
    assert.equal(h.calls.resume.length, 1);
    assert.equal(h.calls.resume[0].resumeSessionId, TOOL_MANAGER_PROBE_SESSION_ID);
    assert.deepEqual(h.calls.mount, ["minimal"]);

    await h.probe.dispose();
  });

  it("serializes concurrent Preset switches on the shared Agent", async () => {
    let release;
    let markStarted;
    const firstGate = new Promise((resolve) => {
      release = resolve;
    });
    const started = new Promise((resolve) => {
      markStarted = resolve;
    });
    const h = harness({
      recomposeGate: async (id) => {
        if (id === "cordis") {
          markStarted();
          await firstGate;
        }
      },
    });

    await h.probe.inspect("standard");
    const first = h.probe.inspect("cordis");
    const second = h.probe.inspect("minimal");
    await started;
    assert.deepEqual(h.calls.recompose, ["cordis"]);
    release();

    assert.deepEqual((await first).map((item) => item.name), ["tool-cordis"]);
    assert.deepEqual((await second).map((item) => item.name), ["tool-minimal"]);
    assert.equal(h.maxActive, 1);
    assert.deepEqual(h.calls.recompose, ["cordis", "minimal"]);

    await h.probe.dispose();
  });

  it("does not create a replacement when the fixed Session cannot resume", async () => {
    const h = harness({ persisted: true, resumeError: new Error("corrupt probe") });

    await assert.rejects(() => h.probe.inspect("standard"), /corrupt probe/);
    assert.equal(h.calls.resume.length, 1);
    assert.equal(h.calls.create.length, 0);
    assert.equal(h.calls.dispose, 0);

    await h.probe.dispose();
  });

  it("degrades without persistence instead of creating disposable Sessions", async () => {
    const calls = { create: 0 };
    const context = {
      get(name) {
        if (name === "agents") {
          return {
            list: () => [],
            create: async () => {
              calls.create += 1;
              throw new Error("must not create without persistence");
            },
            resume: async () => {
              throw new Error("must not resume without persistence");
            },
          };
        }
        return undefined;
      },
      on() {},
    };
    const presets = {
      composedPreset: () => undefined,
      mount: async () => {},
      recompose: async () => {},
    };
    const probe = new PresetSchemaProbe(context, presets);

    assert.deepEqual(await probe.inspect("standard"), []);
    assert.equal(calls.create, 0);
    await probe.dispose();
  });
});
