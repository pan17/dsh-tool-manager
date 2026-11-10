import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { restoredExposureNames } from "../dist/exposure-history.js";

function session(events, inheritedEventCount = 0) {
  return {
    seq: events.length,
    inheritedEventCount,
    eventAt(seq) {
      const event = events[seq];
      return event === undefined ? undefined : { seq, ...event };
    },
  };
}

function call(callId, group, name = "tool_list") {
  return {
    type: "tool/call",
    data: { callId, name, arguments: JSON.stringify({ group }) },
  };
}

function result(callId, isError = false) {
  // The shape DSH persists: its own tool message, identity and error on the message.
  return {
    type: "tool/result",
    data: {
      turn: 1,
      step: 1,
      message: {
        role: "tool",
        source: { kind: "tool", callId },
        toolCallId: callId,
        content: [{ type: "text", text: "{}" }],
        isError,
        id: `result-${callId}`,
      },
    },
  };
}

function providerResult(callId, isError = false) {
  // A provider-shaped message keeps the tool-result block inside content.
  return {
    type: "tool/result",
    data: {
      message: {
        content: [{ type: "tool-result", toolCallId: callId, content: [], isError }],
      },
    },
  };
}

function ptc(group, isError = false, args = { group }) {
  return {
    type: "tool/ptc-dispatch",
    data: { name: "tool_list", arguments: args, isError, content: [] },
  };
}

describe("tool_list exposure history", () => {
  it("restores successful native tool_list calls and deduplicates groups", () => {
    const restored = restoredExposureNames(session([
      call("call-1", "GitHub MCP"),
      result("call-1"),
      call("call-2", " GitHub MCP "),
      result("call-2"),
      call("call-3", "Search"),
      result("call-3"),
    ]));
    assert.deepEqual([...restored], ["GitHub MCP", "Search"]);
  });

  it("ignores failed, incomplete, unrelated, and malformed native calls", () => {
    const restored = restoredExposureNames(session([
      call("failed", "Failed"),
      result("failed", true),
      call("pending", "Pending"),
      call("other", "Other", "skill"),
      result("other"),
      { type: "tool/call", data: { callId: "bad", name: "tool_list", arguments: "{" } },
      result("bad"),
      result("missing"),
    ]));
    assert.deepEqual([...restored], []);
  });

  it("restores successful PTC dispatches and ignores failed or malformed ones", () => {
    const restored = restoredExposureNames(session([
      ptc("Browser"),
      ptc("Failed", true),
      ptc("String Args", false, JSON.stringify({ group: "String Args" })),
      ptc("ignored", false, "{"),
      { type: "tool/ptc-dispatch", data: { name: "skill", arguments: { group: "Other" }, isError: false } },
    ]));
    assert.deepEqual([...restored], ["Browser", "String Args"]);
  });

  it("reads a provider-shaped tool result as well", () => {
    const restored = restoredExposureNames(session([
      call("a", "Provider Group"),
      providerResult("a"),
      call("b", "Provider Failure"),
      providerResult("b", true),
    ]));
    assert.deepEqual([...restored], ["Provider Group"]);
  });

  it("restores the groups a fork inherited from its parent prefix", () => {
    const restored = restoredExposureNames(session([
      call("parent", "Parent Group"),
      result("parent"),
      { type: "session/end-seed", data: { inherited: true } },
      call("child", "Child Group"),
      result("child"),
    ], 3));
    assert.deepEqual([...restored], ["Parent Group", "Child Group"]);
  });

  it("leaves groups closed when the fork point predates the call that opened them", () => {
    // A group the parent opened after the fork is not in the child's log at all.
    const restored = restoredExposureNames(session([
      { type: "user/message", data: { source: { kind: "user" } } },
      { type: "session/end-seed", data: { inherited: true } },
    ], 2));
    assert.deepEqual([...restored], []);
  });

  it("tolerates a missing Session and ignores the inherited boundary it no longer reads", () => {
    assert.deepEqual([...restoredExposureNames(undefined)], []);
    const restored = restoredExposureNames({
      ...session([call("x", "Recovered"), result("x")]),
      inheritedEventCount: -1,
    });
    assert.deepEqual([...restored], ["Recovered"]);
  });
});
