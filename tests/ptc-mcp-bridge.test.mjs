
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ToolPolicyRuntime } from "../dist/runtime.js";

const SCHEMAS = [
  { name: "read", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } } } },
  { name: "calendar", description: "Read and write calendar events", parameters: { type: "object", properties: { day: { type: "string" } }, required: ["day"] } },
  { name: "secret", description: "A disabled tool", parameters: { type: "object" } },
  { name: "tool_list", description: "group opener", parameters: {} },
];

const SETTINGS = {
  presets: {
    standard: {
      mode: "mcp",
      disabled: ["secret"],
      groups: [{ name: "浏览器", description: "网页操作", patterns: ["calendar"] }],
    },
  },
};

/**
 * A Host tools service shaped like the real one for the two reads a PTC step
 * makes: `definitions()` feeds the generated SDK text, `schemas()` feeds the
 * program's `tools` namespace. The host derives the second from the first
 * today, which is exactly what leaves a grouped tool unbound, so this fake
 * derives it the same way and nothing else.
 */
function harness() {
  const registered = new Map();
  const ptcExecutor = { renderSdk: (defs = []) => defs.map((def) => `function ${def.name}() {}`).join("\n") };
  const nativeExecutor = { describe: () => ({ schemas: [] }) };
  const agents = [];
  let ptcAgent;
  const hostTools = {
    definitions(scope, toolSet) {
      return toolSet === undefined
        ? SCHEMAS.map((schema) => ({ ...schema, execute: async () => ({}) }))
        : [...toolSet.view(scope).values()];
    },
    schemas(scope, toolSet) {
      return this.definitions(scope, toolSet).map((definition) => ({
        name: definition.name,
        description: definition.description,
        parameters: definition.parameters,
      }));
    },
    selectExecutor(scope) {
      return scope !== undefined && scope === ptcAgent ? ptcExecutor : nativeExecutor;
    },
    register(definition) {
      registered.set(definition.name, definition);
      return () => registered.delete(definition.name);
    },
    restrict() { return () => {}; },
    async resolve() {
      const view = new Map(SCHEMAS.map((schema) => [schema.name, { ...schema, execute: async () => ({}) }]));
      return { dispose() {}, view: () => view };
    },
  };
  const scopedTools = {
    schemas() { return SCHEMAS; },
    register() { throw new Error("unit test: scoped register must not be used"); },
    restrict() { throw new Error("unit test: mcp mode must not call restrict"); },
    guard() { return () => {}; },
  };
  const makeAgent = (id) => ({
    id,
    ctx: { get(name) { return name === "tools" ? scopedTools : undefined; }, on() { return () => {}; } },
    session: { seq: 0, surface: { nodes: [] }, eventAt() { return undefined; } },
  });
  const nativeAgent = makeAgent("agent-native");
  ptcAgent = makeAgent("agent-ptc");
  agents.push(nativeAgent, ptcAgent);
  const originalSchemas = hostTools.schemas;
  const context = {
    get(name) {
      if (name === "tools") return hostTools;
      if (name === "agents") return { list: () => agents };
      return undefined;
    },
    on() { return () => {}; },
  };
  const runtime = new ToolPolicyRuntime(context, { composedPreset: () => "standard" }, SETTINGS);
  runtime.start();
  return { runtime, nativeAgent, ptcAgent, hostTools, registered, originalSchemas };
}

describe("mcp mode on a PTC preset — program binding bridge", () => {
  it("binds a grouped tool for a PTC program while the SDK text keeps it out", async () => {
    const { runtime, ptcAgent, hostTools } = harness();
    const set = await hostTools.resolve({ agent: ptcAgent });
    assert.ok(![...set.view(ptcAgent).keys()].includes("calendar"),
      "the generated SDK must not declare the grouped tool");
    const schemas = hostTools.schemas(ptcAgent, set);
    const names = schemas.map((schema) => schema.name);
    assert.ok(names.includes("calendar"),
      "a PTC program needs a binding for the grouped tool, or `await tools.calendar()` is a TypeError");
    assert.ok(names.includes("read"), "always-on tools keep their binding");
    assert.ok(!names.includes("secret"), "a disabled tool stays unbound");
    assert.ok(!names.includes("tool_list"), "the group opener stays unbound");
    const calendar = schemas.find((schema) => schema.name === "calendar");
    assert.equal(calendar.parameters.properties.day.type, "string",
      "the binding carries the real parameter schema, not a shell");
    await runtime.dispose();
  });

  it("leaves a native preset with the declared-only answer", async () => {
    const { runtime, nativeAgent, hostTools } = harness();
    const set = await hostTools.resolve({ agent: nativeAgent });
    const names = hostTools.schemas(nativeAgent, set).map((schema) => schema.name);
    assert.deepEqual(names, ["read"],
      "native dispatch reads the map's get(); schemas() must not start declaring grouped tools");
    await runtime.dispose();
  });

  it("restores the host schemas method when the runtime is disposed", async () => {
    const { runtime, hostTools, originalSchemas } = harness();
    assert.notEqual(hostTools.schemas, originalSchemas, "the bridge installs one wrapper");
    await runtime.dispose();
    assert.equal(hostTools.schemas, originalSchemas, "unloading leaves the Host untouched");
  });
});
