import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UserNotices } from "../dist/notices.js";
import { ToolPolicyRuntime } from "../dist/runtime.js";

function schema(name) {
  return { name, description: name };
}

describe("user notices", () => {
  it("collapses repeats of the same Session and preset", () => {
    const notices = new UserNotices();
    assert.ok(notices.add({ kind: "failed", sessionId: "s1", presetId: "standard", message: "first" }));
    assert.equal(notices.add({ kind: "failed", sessionId: "s1", presetId: "standard", message: "again" }), undefined);
    assert.equal(notices.list().length, 1);
    assert.ok(notices.add({ kind: "failed", sessionId: "s2", presetId: "standard", message: "other" }));
    assert.equal(notices.list().length, 2);
  });

  it("drops only the acknowledged ids", () => {
    const notices = new UserNotices();
    const first = notices.add({ kind: "failed", sessionId: "s1", presetId: "standard", message: "one" });
    notices.add({ kind: "failed", sessionId: "s2", presetId: "standard", message: "two" });
    assert.equal(notices.ack([first.id]), 1);
    assert.deepEqual(notices.list().map((item) => item.message), ["two"]);
    assert.equal(notices.ack(["missing"]), 0);
    assert.equal(notices.pending, true);
  });

  it("keeps the newest notices when the box overflows", () => {
    const notices = new UserNotices();
    for (let index = 0; index < 25; index += 1) {
      notices.add({ kind: "failed", sessionId: `s${index}`, presetId: "standard", message: `m${index}` });
    }
    assert.equal(notices.list().length, 20);
    assert.equal(notices.list().at(-1).message, "m24");
  });
});

describe("a Session the manager cannot re-attach", () => {
  /** The residual case: the plugin loaded after the replacement, so no handles. */
  function host() {
    const listeners = new Map();
    const scopedTools = {
      schemas: () => [schema("read")],
      register: () => () => {},
      restrict: () => () => {},
    };
    const agent = {
      id: "session-9",
      ctx: { get: (name) => (name === "tools" ? scopedTools : undefined), on: () => () => {} },
      session: { seq: 0, eventAt: () => undefined, surface: { nodes: [] } },
    };
    const context = {
      get(name) {
        if (name === "tools") return { schemas: () => [], register: () => () => {}, restrict: () => () => {} };
        if (name === "agents") return { list: () => [agent] };
        return undefined;
      },
      on(event, listener) {
        listeners.set(event, [...(listeners.get(event) ?? []), listener]);
        return () => {};
      },
    };
    return { agent, context, listeners };
  }

  it("tells the person and writes nothing into the transcript", async () => {
    const h = host();
    // A registry that answers for nobody: no binding, no retained handles.
    const presets = {
      composedPreset: () => undefined,
      presetForSession: () => "standard",
      compositionInventory: async () => [],
    };
    const userNotices = [];
    const runtime = new ToolPolicyRuntime(
      h.context,
      () => presets,
      { presets: { standard: { disabled: [], groups: [] } } },
      (notice) => userNotices.push(notice),
    );
    runtime.start();

    const waterfall = h.listeners.get("agent/pre-step")[0];
    const decision = await waterfall({ agent: h.agent }, () => ({ kind: "enter", messages: [] }));
    assert.deepEqual(decision.messages, [], "a lost tool set is the reader's to act on");

    assert.equal(userNotices.length, 1, "the reader is told");
    assert.equal(userNotices[0].sessionId, "session-9");
    assert.equal(userNotices[0].presetId, "standard");
    assert.match(userNotices[0].message, /重启 DSH/);
    assert.match(userNotices[0].message, /切换会话无效/);

    // Said once: a second step must not stack banners.
    await waterfall({ agent: h.agent }, () => ({ kind: "enter", messages: [] }));
    assert.equal(userNotices.length, 1);
    await runtime.dispose();
  });
});

describe("a transient reload notice", () => {
  it("is withdrawn once the repair succeeds", () => {
    const notices = new UserNotices();
    notices.add({ kind: "reloading", sessionId: "s1", presetId: "standard", message: "will re-attach" });
    assert.equal(notices.list().length, 1);
    notices.settle("s1", "standard");
    assert.equal(notices.list().length, 0);
  });

  it("withdraws the whole story when a late repair succeeds", () => {
    const notices = new UserNotices();
    notices.add({ kind: "reloading", sessionId: "s1", presetId: "standard", message: "will re-attach" });
    notices.add({ kind: "failed", sessionId: "s1", presetId: "standard", message: "restart DSH" });
    assert.equal(notices.list().length, 2, "the two stages are distinct notices");
    // A failed repair is retried on later steps; success must clear the claim.
    notices.settle("s1", "standard");
    assert.deepEqual(notices.list(), []);
  });
});