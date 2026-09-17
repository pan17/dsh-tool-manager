import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ToolPolicyRuntime } from "../dist/runtime.js";

function resumedSession() {
  const events = [
    { type: "tool/call", data: { callId: "open-1", name: "tool_list", arguments: JSON.stringify({ group: "GitHub" }) } },
    {
      type: "tool/result",
      data: { message: { content: [{ type: "tool-result", toolCallId: "open-1", content: [], isError: false }] } },
    },
    { type: "tool/call", data: { callId: "old-1", name: "tool_list", arguments: JSON.stringify({ group: "Removed" }) } },
    {
      type: "tool/result",
      data: { message: { content: [{ type: "tool-result", toolCallId: "old-1", content: [], isError: false }] } },
    },
  ];
  return {
    seq: events.length,
    inheritedEventCount: 0,
    eventAt(seq) {
      const event = events[seq];
      return event === undefined ? undefined : { seq, ...event };
    },
    surface: { nodes: [] },
  };
}

describe("ToolPolicyRuntime restart recovery", () => {
  it("records tools that only exist in a live Agent scope", async () => {
    const scopedSchemas = ["read", "subagent"].map((name) => ({ name, description: name, parameters: {} }));
    const standingSchemas = [{ name: "read", description: "read", parameters: {} }];
    const scopedTools = {
      schemas() { return scopedSchemas; },
      register() { throw new Error("scope register should not be used"); },
      restrict() { return () => {}; },
    };
    const agent = {
      ctx: { get(name) { return name === "tools" ? scopedTools : undefined; }, on() {} },
      session: resumedSession(),
    };
    const context = {
      get(name) {
        if (name === "tools") return {
          schemas() { return standingSchemas; },
          register() { return () => {}; },
          restrict() { throw new Error("host restrict should not be used"); },
        };
        if (name === "agents") return { list: () => [agent] };
        return undefined;
      },
      on() {},
    };
    const presets = { composedPreset: () => "standard" };

    const runtime = new ToolPolicyRuntime(context, presets, { presets: {} });
    runtime.start();

    assert.deepEqual(runtime.observedSchemasFor("standard").map((item) => item.name), ["read", "subagent"]);
    await runtime.dispose();
  });

  it("filters and guards tools registered in the Agent's own scope", async () => {
    const schemas = ["read", "subagent"].map((name) => ({ name, description: name, parameters: {} }));
    let guard;
    let assemble;
    const scopedTools = {
      schemas() { return schemas; },
      register() { throw new Error("scope register should not be used"); },
      restrict() { throw new Error('tool "subagent" is scoped, not globally restrictable; known global tools: read'); },
      guard(callback) { guard = callback; return () => {}; },
    };
    const agent = {
      ctx: {
        get(name) { return name === "tools" ? scopedTools : undefined; },
        on(name, handler) { if (name === "system-prompt/assemble") assemble = handler; return () => {}; },
      },
      session: resumedSession(),
    };
    const context = {
      get(name) {
        if (name === "tools") return { schemas() { return schemas; }, register() { return () => {}; } };
        if (name === "agents") return { list: () => [agent] };
        return undefined;
      },
      on() {},
    };
    const presets = { composedPreset: () => "standard" };
    const runtime = new ToolPolicyRuntime(context, presets, {
      presets: { standard: { disabled: ["subagent"], groups: [] } },
    });
    runtime.start();

    const filtered = await assemble({}, {}, async () => ({
      tools: schemas,
      sections: [{ name: "tool:read" }, { name: "tool:subagent" }, { name: "identity" }],
      contexts: [],
      variables: {},
    }));
    assert.deepEqual(filtered.tools.map((item) => item.name), ["read"]);
    assert.deepEqual(filtered.sections.map((item) => item.name), ["tool:read", "identity"]);
    assert.match(guard({ name: "subagent" }), /disabled by the tool-manager policy/);
    assert.equal(guard({ name: "read" }), undefined);
    await runtime.dispose();
  });

  it("keeps restored groups open while enforcing other hidden and disabled tools", async () => {
    const applied = [];
    const schemas = ["tool_list", "mcp__github__issue", "web_search", "write"].map((name) => ({
      name,
      description: name,
      parameters: {},
    }));
    const scopedTools = {
      schemas() { return schemas; },
      register() { throw new Error("scope register should not be used"); },
      restrict({ deny }) {
        applied.push([...deny]);
        return () => {};
      },
    };
    const agent = {
      ctx: { get(name) { return name === "tools" ? scopedTools : undefined; }, on() {} },
      session: resumedSession(),
    };
    const handlers = new Map();
    const hostTools = {
      schemas() { return schemas; },
      register() { return () => {}; },
      restrict() { throw new Error("host restrict should not be used"); },
    };
    const context = {
      get(name) {
        if (name === "tools") return hostTools;
        if (name === "agents") return { list: () => [agent] };
        return undefined;
      },
      on(name, handler) { handlers.set(name, handler); },
    };
    const presets = { composedPreset: () => "standard" };
    const settings = {
      presets: {
        standard: {
          disabled: ["write"],
          groups: [
            { name: "GitHub", patterns: ["mcp__github__issue"] },
            { name: "Web", patterns: ["web_search"] },
          ],
        },
      },
    };

    const runtime = new ToolPolicyRuntime(context, presets, settings);
    runtime.start();

    assert.deepEqual(applied.at(-1), ["web_search", "write"]);
    await runtime.dispose();
  });
});
