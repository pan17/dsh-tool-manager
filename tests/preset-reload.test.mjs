import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply, CompositionWatch, DefaultPresetMount, PresetSchemaProbe } from "../dist/index.js";
import { ToolPolicyRuntime } from "../dist/runtime.js";
import { TOOL_MANAGER_PROBE_SESSION_ID } from "../dist/types.js";

// The plugin reads its policy store on load; keep that read away from the
// developer's real configuration.
process.env.DSH_TOOL_MANAGER_CONFIG = join(tmpdir(), "dsh-tool-manager-reload-test-config.json");

function schema(name) {
  return { name, description: name, parameters: {} };
}

/**
 * One `agentPresets` service instance, as DSH publishes one.
 *
 * A reload retires the instance: its unregister disposers empty `definitions`,
 * so the retired object answers with an empty roster and no bindings while the
 * new instance owns both.
 */
function registry(roster) {
  const state = { roster, composed: undefined, declared: undefined, calls: { compose: [], mount: [], recompose: [] } };
  return {
    state,
    composedPreset() {
      return state.composed;
    },
    /** The Session log keeps naming the preset after the binding is gone. */
    presetForSession() {
      return state.declared;
    },
    async compositionInventory() {
      return state.roster;
    },
    async acquireScope(id) {
      state.calls.compose.push(id);
      return { key: id ?? "<default>", async [Symbol.asyncDispose]() {} };
    },
    async mount(_ctx, id) {
      state.calls.mount.push(id);
      state.composed = id;
      state.declared = id;
    },
    async recompose(_ctx, id) {
      state.calls.recompose.push(id);
      state.composed = id;
      state.declared = id;
    },
    /** What DSH's unregister disposers leave behind: bindings and roster gone. */
    retire() {
      state.roster = [];
      state.composed = undefined;
    },
  };
}

function preset(id, isDefault = false) {
  return { id, isDefault };
}

/** A Host whose services can be replaced, like DSH does on reload. */
function host(initial) {
  const routes = new Map();
  const listeners = new Map();
  const warnings = [];
  const tools = {
    schemas: () => [],
    register: () => () => {},
    restrict: () => () => {},
  };
  let current = initial;
  const context = {
    get(name) {
      if (name === "agentPresets") return current;
      if (name === "tools") return tools;
      if (name === "agents") return { list: () => [] };
      if (name === "logger") return { warn: (message) => warnings.push(message) };
      return undefined;
    },
    on(event, listener) {
      const bucket = listeners.get(event) ?? [];
      bucket.push(listener);
      listeners.set(event, bucket);
      return () => {};
    },
    inject(deps, callback) {
      if (!deps.includes("webServer")) return;
      callback({
        get(name) {
          if (name !== "webServer") return undefined;
          return {
            register(route) {
              routes.set(route.path, route);
              return () => {};
            },
          };
        },
      });
    },
    effect() {
      return () => {};
    },
  };
  return {
    context,
    routes,
    warnings,
    publish(next) {
      current = next;
    },
  };
}

function request(route) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 0,
      headers: {},
      setHeader(name, value) {
        this.headers[name] = value;
      },
      end(chunk) {
        resolve({ status: this.statusCode, body: chunk ? JSON.parse(chunk) : undefined });
      },
    };
    route.handler({ method: "GET" }, res);
  });
}

const SNAPSHOT = "/tool-manager/api/snapshot";

function snapshotOf(h) {
  return request(h.routes.get(SNAPSHOT));
}

describe("agent preset registry reload", () => {
  it("answers from the instance DSH publishes in place of a retired one", async () => {
    const first = registry([preset("standard", true)]);
    const h = host(first);
    apply(h.context);

    const before = await snapshotOf(h);
    assert.equal(before.status, 200);
    assert.deepEqual(before.body.presets.map((item) => item.id), ["standard"]);

    // DSH re-applies the registry node: the same Fiber publishes a new service
    // instance, every preset re-registers into it, and the old one is empty.
    first.retire();
    h.publish(registry([preset("standard", true), preset("cordis")]));

    const after = await snapshotOf(h);
    assert.equal(after.status, 200);
    assert.deepEqual(after.body.presets.map((item) => item.id), ["standard", "cordis"]);
  });

  it("asks the page to retry while no registry instance is provided", async () => {
    const h = host(registry([preset("standard", true)]));
    apply(h.context);
    h.publish(undefined);

    const response = await snapshotOf(h);
    assert.equal(response.status, 503);
    assert.match(response.body.message, /reloading/);
  });

  it("waits out a reload that publishes the instance before its presets", async () => {
    const h = host(registry([preset("standard", true)]));
    apply(h.context);
    await snapshotOf(h);

    const incoming = registry([]);
    h.publish(incoming);
    setTimeout(() => {
      incoming.state.roster = [preset("standard", true)];
    }, 200);

    const response = await snapshotOf(h);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.presets.map((item) => item.id), ["standard"]);
  });

  it("waits for an empty roster only once per registry instance", async () => {
    const empty = registry([]);
    let reads = 0;
    const counting = {
      ...empty,
      async compositionInventory() {
        reads += 1;
        return empty.state.roster;
      },
    };
    const h = host(counting);
    apply(h.context);

    await snapshotOf(h);
    assert.ok(reads > 1, "the first empty answer waits for the roster to fill");

    const waited = reads;
    await snapshotOf(h);
    // One roster read for the catalog, one for the snapshot itself: a settled
    // instance costs no polls.
    assert.equal(reads - waited, 2, "a settled instance answers without waiting again");
  });

  it("composes the session default once per registry instance", async () => {
    let instance = registry([preset("standard", true)]);
    const mount = new DefaultPresetMount(() => instance, () => {});

    await mount.ensure();
    await mount.ensure();
    assert.equal(instance.state.calls.compose.length, 1);

    const next = registry([preset("standard", true)]);
    instance = next;
    await mount.ensure();
    assert.equal(next.state.calls.compose.length, 1);
  });

  it("rebinds the probe Agent to the new registry instance", async () => {
    const created = [];
    const calls = { dispose: 0 };
    let current = registry([preset("standard", true)]);
    const tools = { schemas: () => [schema("read")] };
    const context = {
      get(name) {
        if (name === "agentPresets") return current;
        if (name === "agents") {
          return {
            list: () => [],
            async create(options) {
              created.push(options.sessionId);
              const handle = {
                agent: { ctx: { get: (service) => (service === "tools" ? tools : undefined) } },
                async dispose() {
                  calls.dispose += 1;
                },
              };
              await options.setup?.(handle.agent.ctx, handle.agent);
              return handle;
            },
            async resume() {
              throw new Error("the probe Session is not persisted in this test");
            },
          };
        }
        if (name === "sessionPersistence") return { stat: async () => undefined };
        return undefined;
      },
      on() {},
    };
    const probe = new PresetSchemaProbe(context, () => current);

    assert.deepEqual((await probe.inspect("standard")).map((item) => item.name), ["read"]);
    assert.equal(created.length, 1);
    assert.deepEqual(current.state.calls.mount, ["standard"]);

    current = registry([preset("standard", true)]);
    assert.deepEqual((await probe.inspect("standard")).map((item) => item.name), ["read"]);
    assert.equal(created.length, 2);
    assert.equal(calls.dispose, 1);
    assert.deepEqual(current.state.calls.mount, ["standard"]);

    await probe.dispose();
    assert.equal(calls.dispose, 2);
  });

  it("keeps the probe Session id stable across a reload", async () => {
    const created = [];
    let current = registry([preset("standard", true)]);
    const context = {
      get(name) {
        if (name === "agentPresets") return current;
        if (name === "agents") {
          return {
            list: () => [],
            async create(options) {
              created.push(options);
              return {
                agent: { ctx: { get: () => undefined } },
                async dispose() {},
              };
            },
          };
        }
        if (name === "sessionPersistence") return { stat: async () => undefined };
        return undefined;
      },
      on() {},
    };
    const probe = new PresetSchemaProbe(context, () => current);

    await probe.inspect("standard");
    current = registry([preset("standard", true)]);
    await probe.inspect("standard");

    assert.deepEqual(created.map((options) => options.sessionId), [
      TOOL_MANAGER_PROBE_SESSION_ID,
      TOOL_MANAGER_PROBE_SESSION_ID,
    ]);
    await probe.dispose();
  });
});

describe("a registry reload that retires a Session's composition", () => {
  function startedSession() {
    return { seq: 1, eventAt: () => undefined, surface: { nodes: [] } };
  }

  function runtimeHost() {
    const listeners = new Map();
    const denies = [];
    const scopedTools = {
      schemas: () => [schema("read"), schema("subagent")],
      register: () => () => {},
      restrict(filter) {
        denies.push(filter.deny);
        return () => {};
      },
    };
    const agent = {
      id: "session-1",
      ctx: { get: (name) => (name === "tools" ? scopedTools : undefined), on: () => () => {} },
      session: startedSession(),
    };
    const context = {
      get(name) {
        if (name === "tools") return { schemas: () => [], register: () => () => {}, restrict: () => () => {} };
        if (name === "agents") return { list: () => [agent] };
        return undefined;
      },
      on(event, listener) {
        const bucket = listeners.get(event) ?? [];
        bucket.push(listener);
        listeners.set(event, bucket);
        return () => {};
      },
    };
    return { agent, context, listeners, scopedTools, denies };
  }

  it("keeps the Session's policy and leaves the step untouched", async () => {
    const h = runtimeHost();
    const first = registry([preset("standard", true)]);
    first.state.composed = "standard";
    first.state.declared = "standard";
    let current = first;

    const userNotices = [];
    const runtime = new ToolPolicyRuntime(
      h.context,
      () => current,
      { presets: { standard: { disabled: ["subagent"], groups: [] } } },
      (notice) => userNotices.push(notice),
    );
    runtime.start();
    assert.deepEqual(h.denies.at(-1), ["subagent"]);

    // The reload: same Session log, no binding on the new instance.
    const second = registry([preset("standard", true)]);
    second.state.declared = "standard";
    current = second;
    runtime.update({ presets: { standard: { disabled: ["subagent"], groups: [] } } });

    const waterfall = h.listeners.get("agent/pre-step");
    assert.equal(waterfall.length, 1);
    const decision = { kind: "enter", messages: [] };
    const stepped = await waterfall[0]({ agent: h.agent }, () => decision);
    assert.deepEqual(stepped.messages, [], "nothing is written into the transcript");
    assert.equal(userNotices.length, 1, "the reader is told instead");
    assert.match(userNotices[0].message, /重启 DSH/);

    await waterfall[0]({ agent: h.agent }, () => ({ kind: "enter", messages: [] }));
    assert.equal(userNotices.length, 1, "said once per Session");

    // The policy still hides what the user disabled: silently re-enabling tools
    // is worse than a Session that is missing them.
    assert.deepEqual(h.denies.at(-1), ["subagent"]);
    await runtime.dispose();
  });

  it("leaves a lost binding to the policy runtime instead of re-calibrating", async () => {
    const warnings = [];
    const agent = {
      id: "session-1",
      ctx: { names: ["read"] },
      session: startedSession(),
    };
    const first = registry([preset("standard", true)]);
    first.state.composed = "standard";
    first.state.declared = "standard";
    let current = first;

    const watch = new CompositionWatch({
      presets: () => current,
      agents: () => [agent],
      tools: () => ({ schemas: () => agent.ctx.names.map(schema) }),
      warn: (message) => warnings.push(message),
      debounceMs: 0,
    });
    watch.start({ on: () => () => {} });
    await watch.flush();

    const second = registry([preset("standard", true)]);
    second.state.declared = "standard";
    current = second;
    await watch.flush();
    await watch.flush();

    assert.deepEqual(warnings, [], "re-attaching a reloaded registry is the policy runtime's job");
    assert.deepEqual(second.state.calls.recompose, [], "a lost binding cannot be re-linked, so nothing is attempted");
    watch.dispose();
  });
});
