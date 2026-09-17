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
