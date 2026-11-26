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

function memberCall(callId, name) {
  return {
    type: "tool/call",
    data: { callId, name, arguments: "{}" },
  };
}

function memberPtc(name, isError = false) {
  return {
    type: "tool/ptc-dispatch",
    data: { name, arguments: "{}", isError, content: [] },
  };
}

function compaction(error) {
  return {
    type: "compaction/end",
    data: error === undefined ? { turn: 1 } : { turn: 1, error },
  };
}

function group(name, tools) {
  return { name, description: "", patterns: tools, tools };
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

describe("compaction keep limit", () => {
  const groups = [group("GitHub", ["github_issue"]), group("Search", ["web_search"]), group("Browser", ["browser_open"])];

  it("keeps every opened group when no limit is configured", () => {
    const restored = restoredExposureNames(session([
      call("a", "GitHub"),
      result("a"),
      compaction(),
      call("b", "Search"),
      result("b"),
    ]), { groups });
    assert.deepEqual([...restored], ["GitHub", "Search"]);
  });

  it("keeps only the most recently opened groups after a completed compaction", () => {
    const restored = restoredExposureNames(session([
      call("a", "GitHub"),
      result("a"),
      call("b", "Search"),
      result("b"),
      call("c", "Browser"),
      result("c"),
      compaction(),
    ]), { groups, keepAfterCompaction: 2 });
    assert.deepEqual([...restored], ["Search", "Browser"]);
  });

  it("ranks a group by its newest successful member-tool call", () => {
    const restored = restoredExposureNames(session([
      call("a", "GitHub"),
      result("a"),
      call("b", "Search"),
      result("b"),
      memberCall("use", "github_issue"),
      result("use"),
      compaction(),
    ]), { groups, keepAfterCompaction: 1 });
    assert.deepEqual([...restored], ["GitHub"]);
  });

  it("keeps groups opened after the compaction even beyond the limit", () => {
    const restored = restoredExposureNames(session([
      call("a", "GitHub"),
      result("a"),
      call("b", "Search"),
      result("b"),
      compaction(),
      call("c", "Browser"),
      result("c"),
    ]), { groups, keepAfterCompaction: 1 });
    assert.deepEqual([...restored], ["Search", "Browser"]);
  });

  it("closes every opened group when the limit is zero", () => {
    const restored = restoredExposureNames(session([
      call("a", "GitHub"),
      result("a"),
      call("b", "Search"),
      result("b"),
      compaction(),
    ]), { groups, keepAfterCompaction: 0 });
    assert.deepEqual([...restored], []);
  });

  it("closes a group that stayed open through an interval without being touched", () => {
    const restored = restoredExposureNames(session([
      call("a", "GitHub"),
      result("a"),
      call("b", "Search"),
      result("b"),
      compaction(),
      { type: "user/message", data: {} },
      compaction(),
    ]), { groups, keepAfterCompaction: 1 });
    assert.deepEqual([...restored], []);
  });

  it("keeps a group used between the two compactions", () => {
    const restored = restoredExposureNames(session([
      call("a", "GitHub"),
      result("a"),
      call("b", "Search"),
      result("b"),
      compaction(),
      memberCall("use", "web_search"),
      result("use"),
      compaction(),
    ]), { groups, keepAfterCompaction: 1 });
    assert.deepEqual([...restored], ["Search"]);
  });

  it("keeps a group opened between the two compactions", () => {
    const restored = restoredExposureNames(session([
      call("a", "GitHub"),
      result("a"),
      call("b", "Search"),
      result("b"),
      compaction(),
      call("c", "Browser"),
      result("c"),
      compaction(),
    ]), { groups, keepAfterCompaction: 1 });
    assert.deepEqual([...restored], ["Browser"]);
  });

  it("applies the limit per interval with several groups", () => {
    const restored = restoredExposureNames(session([
      call("a", "GitHub"),
      result("a"),
      call("b", "Search"),
      result("b"),
      call("c", "Browser"),
      result("c"),
      compaction(),
      // Search and Browser were retired by the first cut; GitHub is reopened.
      call("d", "GitHub"),
      result("d"),
      compaction(),
    ]), { groups, keepAfterCompaction: 2 });
    assert.deepEqual([...restored], ["GitHub"]);
  });

  it("ignores failed member calls and failed compactions", () => {
    const restored = restoredExposureNames(session([
      call("a", "GitHub"),
      result("a"),
      call("b", "Search"),
      result("b"),
      memberCall("use", "github_issue"),
      result("use", true),
      compaction("summary failed"),
    ]), { groups, keepAfterCompaction: 1 });
    assert.deepEqual([...restored], ["GitHub", "Search"]);
  });

  it("drops names that no longer name a group, and their slots", () => {
    const repaired = restoredExposureNames(session([
      call("a", "Removed"),
      result("a"),
      call("b", "GitHub"),
      result("b"),
      compaction(),
    ]), { groups, keepAfterCompaction: 1 });
    assert.deepEqual([...repaired], ["GitHub"]);
  });

  it("counts PTC dispatches for opening and for using a group", () => {
    const restored = restoredExposureNames(session([
      ptc("GitHub"),
      ptc("Search"),
      memberPtc("web_search"),
      memberPtc("github_issue", true),
      compaction(),
    ]), { groups, keepAfterCompaction: 1 });
    assert.deepEqual([...restored], ["Search"]);
  });

  it("reopens a group by touching it again after it was pruned", () => {
    const restored = restoredExposureNames(session([
      call("a", "GitHub"),
      result("a"),
      call("b", "Search"),
      result("b"),
      compaction(),
      call("c", "GitHub"),
      result("c"),
    ]), { groups, keepAfterCompaction: 1 });
    assert.deepEqual([...restored], ["Search", "GitHub"]);
  });

  it("keeps the raw names when no groups are supplied", () => {
    const restored = restoredExposureNames(session([
      call("a", "GitHub"),
      result("a"),
      call("b", "Unknown"),
      result("b"),
      memberCall("use", "github_issue"),
      result("use"),
      compaction(),
    ]));
    assert.deepEqual([...restored], ["GitHub", "Unknown"]);
  });
});
