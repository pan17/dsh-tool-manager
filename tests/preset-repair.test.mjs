import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { PresetBindingRepair } from "../dist/preset-repair.js";
import { ToolPolicyRuntime } from "../dist/runtime.js";

/**
 * A registry fake that mirrors the internals the repair depends on, including
 * the rule that makes a reload destructive: a scope key binds once.
 */
/** Module state in dsh-scope: ancestry is global, not per instance. */
const scopeParents = new Map();
const bindScopeParent = (key, parent) => {
  if (scopeParents.has(key)) {
    throw new Error("dsh-scope: scope key is already bound to a parent; re-linking requires the binding returned by the original bind");
  }
  scopeParents.set(key, parent);
  return { rebind: (next) => scopeParents.set(key, next) };
};

function makeRegistry() {
  const state = {
    definitions: new Map(),
    events: [],
    disposed: false,
  };
  const registry = {
    state,
    generations: new Map(),
    bindings: new WeakMap(),
    owner: { emit: (event) => state.events.push(event) },
    async register(id) {
      const generation = { key: { id: `${id}@${Math.random()}` }, users: 0, retired: false, mount: { presetId: id } };
      state.definitions.set(id, generation);
      registry.generations.set(generation.key, generation);
      return generation;
    },
    async retain(id) {
      const generation = state.definitions.get(id);
      if (generation === undefined) throw new Error(`agent-preset/not-found: ${id}`);
      generation.users += 1;
      return generation;
    },
    async collect(generation) {
      if (!generation.retired || generation.users !== 0) return;
      registry.generations.delete(generation.key);
      state.collected = [...(state.collected ?? []), generation.key];
    },
    composedPreset(ctx) {
      return registry.generations.get(scopeParents.get(scopeKeyOf(ctx)))?.mount.presetId;
    },
    bind(ctx, generation) {
      const key = scopeKeyOf(ctx);
      const binding = registry.bindings.get(key);
      if (binding?.generation === generation) return;
      if (binding !== undefined) {
        binding.parent.rebind(generation.key);
        binding.generation.users -= 1;
        binding.generation = generation;
        generation.users += 1;
        return;
      }
      registry.bindings.set(key, { parent: bindScopeParent(key, generation.key), generation });
      generation.users += 1;
    },
    /** What a Loader restart of the node does: the instance and its map die. */
    dispose() {
      state.disposed = true;
    },
  };
  return registry;
}

/** The tag `createScope()` writes onto a context; the repair finds it by probe. */
const kScope = Symbol("dsh.scope");

function makeAgent(id, effects) {
  const key = { agent: id };
  const ctx = {
    [kScope]: key,
    effect: (execute) => { effects.push(execute); return () => {}; },
    on: () => () => {},
  };
  return { id, ctx, key };
}

function scopeKeyOf(ctx) {
  return ctx[kScope];
}

describe("preset binding repair", () => {
  const warnings = [];
  beforeEach(() => {
    warnings.length = 0;
    // The history lives on the global object so it survives a plugin restart;
    // each test starts from a host that has never seen a registry.
    delete globalThis[Symbol.for("dsh-tool-manager.preset-registry-history")];
  });

  function repairOf() {
    return new PresetBindingRepair({ warn: (message) => warnings.push(message) });
  }

  it("re-attaches a Session to the replacement instance's revision", async () => {
    const retired = makeRegistry();
    const standard = await retired.register("standard");
    const effects = [];
    const agent = makeAgent("session-1", effects);
    retired.bind(agent.ctx, standard);
    assert.equal(retired.composedPreset(agent.ctx), "standard");

    // The reload: new instance, own generations and bindings, same definitions.
    retired.dispose();
    const live = makeRegistry();
    const replacement = await live.register("standard");
    assert.equal(live.composedPreset(agent.ctx), undefined);

    const repair = repairOf();
    repair.observe(retired);
    repair.observe(live);
    assert.equal(await repair.relink(agent, "standard"), true);

    assert.equal(live.composedPreset(agent.ctx), "standard");
    assert.equal(replacement.users, 1, "the re-linked binding holds one reference");
    assert.equal(standard.users, 0, "the retired revision's reference is gone");
    assert.deepEqual(live.state.events, ["tools/change"]);
    assert.equal(warnings.length, 0);

    // The registry's own effect still runs on Agent disposal; ours must not
    // double-release, and the revision must not outlive its Agent.
    for (const effect of effects) await effect()();
    assert.equal(replacement.users, 0);
    live.generations.delete(replacement.key);
  });

  it("keeps the Agent's policy when the preset is gone from the replacement", async () => {
    const retired = makeRegistry();
    const standard = await retired.register("standard");
    const effects = [];
    const agent = makeAgent("session-2", effects);
    retired.bind(agent.ctx, standard);

    const live = makeRegistry();
    await live.register("minimal");

    const repair = repairOf();
    repair.observe(retired);
    repair.observe(live);
    await assert.rejects(() => repair.relink(agent, "standard"), /agent-preset\/not-found/);
    assert.equal(live.composedPreset(agent.ctx), undefined);
    assert.equal(warnings.length, 0, "the caller reports the missing preset");
  });

  it("refuses when the plugin loaded after the replacement", async () => {
    const live = makeRegistry();
    await live.register("standard");
    const agent = makeAgent("session-3", []);

    const repair = repairOf();
    repair.observe(live);
    assert.equal(await repair.relink(agent, "standard"), false);
    assert.equal(warnings.length, 0, "nothing to warn about without a Session to save");
  });

  it("warns once per reason when the host hides the handles", async () => {
    const retired = makeRegistry();
    const standard = await retired.register("standard");
    const agent = makeAgent("session-4", []);
    retired.bind(agent.ctx, standard);
    retired.bindings = undefined;

    const live = makeRegistry();
    await live.register("standard");
    const repair = repairOf();
    repair.observe(retired);
    repair.observe(live);
    assert.equal(await repair.relink(agent, "standard"), false);
    assert.equal(await repair.relink(agent, "standard"), false);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /no bindings map/);
  });

  it("re-links again after a second reload", async () => {
    const first = makeRegistry();
    const standard = await first.register("standard");
    const effects = [];
    const agent = makeAgent("session-5", effects);
    first.bind(agent.ctx, standard);

    const second = makeRegistry();
    const revived = await second.register("standard");
    const repair = repairOf();
    repair.observe(first);
    repair.observe(second);
    assert.equal(await repair.relink(agent, "standard"), true);
    assert.equal(second.composedPreset(agent.ctx), "standard");

    const third = makeRegistry();
    const again = await third.register("standard");
    repair.observe(third);
    assert.equal(await repair.relink(agent, "standard"), true);
    assert.equal(third.composedPreset(agent.ctx), "standard");
    assert.equal(again.users, 1);
    assert.equal(revived.users, 0, "the superseded revision is released");
  });
});

describe("a Session whose registry was replaced", () => {
  it("is re-attached before its next step, with no notice and no policy change", async () => {
    const retired = makeRegistry();
    const standard = await retired.register("standard");
    const effects = [];
    const agent = makeAgent("session-7", effects);
    retired.bind(agent.ctx, standard);

    const scopedTools = {
      schemas: () => [{ name: "read" }, { name: "subagent" }],
      register: () => () => {},
      restrict: () => () => {},
    };
    agent.ctx.get = (name) => (name === "tools" ? scopedTools : undefined);
    agent.session = { seq: 0, eventAt: () => undefined, surface: { nodes: [] } };

    const hostTools = { schemas: () => [], register: () => () => {}, restrict: () => () => {} };
    const listeners = new Map();
    const context = {
      get(name) {
        if (name === "tools") return hostTools;
        if (name === "agents") return { list: () => [agent] };
        return undefined;
      },
      on(event, listener) {
        listeners.set(event, [...(listeners.get(event) ?? []), listener]);
        return () => {};
      },
    };

    const settings = { presets: { standard: { disabled: ["subagent"], groups: [] } } };
    let current = retired;
    current.presetForSession = () => "standard";
    const runtime = new ToolPolicyRuntime(context, () => current, settings);
    runtime.start();
    assert.deepEqual(runtime.observedSchemasFor("standard").map((item) => item.name), ["read", "subagent"]);

    // The Loader restarts the registry node: same definitions, new instance.
    const live = makeRegistry();
    await live.register("standard");
    live.presetForSession = () => "standard";
    current = live;
    assert.equal(live.composedPreset(agent.ctx), undefined);

    const waterfall = listeners.get("agent/pre-step")[0];
    const decision = await waterfall({ agent }, () => ({ kind: "enter", messages: [] }));
    assert.equal(live.composedPreset(agent.ctx), "standard", "the runtime re-linked the Session");
    assert.deepEqual(decision.messages, [], "a repaired Session is not told to restart anything");
    assert.deepEqual(runtime.observedSchemasFor("standard").map((item) => item.name), ["read", "subagent"]);
    await runtime.dispose();
  });

  it("re-attaches even when the replacement cannot yet name the Session's preset", async () => {
    const retired = makeRegistry();
    const standard = await retired.register("standard");
    const effects = [];
    const agent = makeAgent("session-13", effects);
    retired.bind(agent.ctx, standard);

    const scopedTools = { schemas: () => [{ name: "read" }], register: () => () => {}, restrict: () => () => {} };
    agent.ctx.get = (name) => (name === "tools" ? scopedTools : undefined);
    agent.session = { seq: 0, eventAt: () => undefined, surface: { nodes: [] } };
    const hostTools = { schemas: () => [], register: () => () => {}, restrict: () => () => {} };
    const listeners = new Map();
    const context = {
      get(name) {
        if (name === "tools") return hostTools;
        if (name === "agents") return { list: () => [agent] };
        return undefined;
      },
      on(event, listener) {
        listeners.set(event, [...(listeners.get(event) ?? []), listener]);
        return () => {};
      },
    };

    let current = retired;
    retired.presetForSession = () => "standard";
    const runtime = new ToolPolicyRuntime(context, () => current, { presets: {} });
    runtime.start();

    // The replacement: its projection handle is empty for this Session, so the
    // Session cannot say what it runs. The lost binding still can.
    const live = makeRegistry();
    await live.register("standard");
    live.presetForSession = () => undefined;
    current = live;

    const waterfall = listeners.get("agent/pre-step")[0];
    await waterfall({ agent }, () => ({ kind: "enter", messages: [] }));
    assert.equal(live.composedPreset(agent.ctx), "standard", "re-linked from the binding alone");
    await runtime.dispose();
  });
});
describe("the two ways a repair can lose its context", () => {
  beforeEach(() => {
    delete globalThis[Symbol.for("dsh-tool-manager.preset-registry-history")];
  });

  it("survives the plugin restart a registry reload causes", async () => {
    const retired = makeRegistry();
    const standard = await retired.register("standard");
    const effects = [];
    const agent = makeAgent("session-8", effects);
    retired.bind(agent.ctx, standard);

    // The instance is recorded while it is still live, by the instance of the
    // plugin that is about to be restarted.
    const before = new PresetBindingRepair({ warn: () => {} });
    before.observe(retired);

    // The restart: a fresh repair object, no instance state carried over.
    const live = makeRegistry();
    await live.register("standard");
    const after = new PresetBindingRepair({ warn: () => {} });
    after.observe(live);

    assert.equal(await after.relink(agent, "standard"), true);
    assert.equal(live.composedPreset(agent.ctx), "standard");
  });

  it("finds the scope key when the context shadows it on the prototype", async () => {
    const retired = makeRegistry();
    const standard = await retired.register("standard");
    const effects = [];
    const key = { agent: "session-9" };
    // `Context.extend()` returns a shadowed object when the context has a
    // use-site shadow, so the scope tag is inherited rather than own.
    const base = { effect: (execute) => { effects.push(execute); return () => {}; }, on: () => () => {} };
    const inner = Object.create(base);
    Object.defineProperty(inner, kScope, { value: key, enumerable: true });
    const shadow = Symbol("dsh.shadow");
    const ctx = Object.assign(Object.create(inner), { [shadow]: inner });
    assert.deepEqual(Object.getOwnPropertySymbols(ctx), [shadow], "the scope tag is inherited");
    const agent = { id: "session-9", ctx };
    retired.bind(ctx, standard);

    const live = makeRegistry();
    await live.register("standard");
    const repair = new PresetBindingRepair({ warn: () => {} });
    repair.observe(retired);
    repair.observe(live);
    assert.equal(await repair.relink(agent, "standard"), true);
    assert.equal(live.composedPreset(ctx), "standard");
  });
});
describe("a replacement that cannot name the Session's preset", () => {
  const warnings = [];
  beforeEach(() => {
    warnings.length = 0;
    delete globalThis[Symbol.for("dsh-tool-manager.preset-registry-history")];
  });
  const repairOf = () => new PresetBindingRepair({ warn: (message) => warnings.push(message) });
  it("re-attaches from the binding the Agent lost, not from the projection", async () => {
    const retired = makeRegistry();
    const standard = await retired.register("standard");
    const effects = [];
    const agent = makeAgent("session-11", effects);
    retired.bind(agent.ctx, standard);

    const live = makeRegistry();
    await live.register("standard");
    // The replacement's projection handle is not populated yet, so asking the
    // Session what it runs returns nothing — the binding still knows.
    live.presetForSession = () => undefined;

    const repair = repairOf();
    repair.observe(retired);
    repair.observe(live);
    assert.equal(repair.boundPreset(agent), "standard");
    assert.equal(await repair.relink(agent, undefined), true);
    assert.equal(live.composedPreset(agent.ctx), "standard");
    assert.deepEqual(
      repair.diagnostics().attempts.map((attempt) => attempt.outcome),
      ["re-attached"],
    );
  });

  it("still reports why it gave up", async () => {
    const retired = makeRegistry();
    const standard = await retired.register("standard");
    const effects = [];
    const agent = makeAgent("session-12", effects);
    retired.bind(agent.ctx, standard);

    const live = makeRegistry();
    await live.register("standard");
    const repair = repairOf();
    repair.observe(retired);
    // The replacement never publishes its internals: nothing to rebind with.
    const opaque = { composedPreset: () => undefined };
    repair.observe(opaque);
    assert.equal(await repair.relink(agent, "standard"), false);
    assert.match(repair.diagnostics().refusals.join(" "), /no-retain/);
  });
});