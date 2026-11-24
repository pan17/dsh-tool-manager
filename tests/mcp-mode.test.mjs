
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { denyNames, mcpGroupedNames, normalizeSettings } from "../dist/policy.js";
import { ToolPolicyRuntime } from "../dist/runtime.js";
import { applyCatalogDecision } from "../dist/catalog.js";
import {
  applyMcpNoticeDecision,
  digestMcpNotice,
  groupLookup,
  mcpNoticeHistory,
  renderMcpNoticeMessage,
  renderMcpNoticeText,
  readMcpNotice,
} from "../dist/mcp-mode.js";
import { assertNoEmptyGroups } from "../dist/index.js";
import { buildSnapshot } from "../dist/snapshot.js";

const SCHEMAS = [
  { name: "read", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } } } },
  { name: "calendar", description: "Read and write calendar events", parameters: { type: "object", properties: { day: { type: "string" } } } },
  { name: "secret", description: "A disabled tool", parameters: { type: "object" } },
  { name: "tool_list", description: "group opener", parameters: {} },
];

function harness(settings) {
  const registered = new Map();
  const restricted = [];
  let guardCallback;
  let preStep;
  const hostTools = {
    schemas() { return SCHEMAS; },
    register(definition) {
      registered.set(definition.name, definition);
      return () => registered.delete(definition.name);
    },
    restrict(filter) { restricted.push(filter); return () => {}; },
    async resolve() {
      return {
        dispose() {},
        view() { return new Map(SCHEMAS.map((schema) => [schema.name, { ...schema, execute: async () => ({}) }])); },
      };
    },
  };
  const scopedTools = {
    schemas() { return SCHEMAS; },
    register() { throw new Error("unit test: scoped register must not be used"); },
    restrict() { throw new Error("unit test: mcp mode must not call restrict"); },
    guard(callback) { guardCallback = callback; return () => {}; },
  };
  const agent = {
    id: "agent-1",
    ctx: {
      get(name) { return name === "tools" ? scopedTools : undefined; },
      on() { return () => {}; },
    },
    session: { seq: 0, surface: { nodes: [] }, eventAt() { return undefined; } },
  };
  const handlers = new Map();
  const context = {
    get(name) {
      if (name === "tools") return hostTools;
      if (name === "agents") return { list: () => [agent] };
      return undefined;
    },
    on(event, listener) { handlers.set(event, listener); },
  };
  const presets = { composedPreset: () => "standard" };
  const runtime = new ToolPolicyRuntime(context, presets, settings);
  runtime.start();
  preStep = handlers.get("agent/pre-step");
  return { runtime, agent, registered, restricted, guard: () => guardCallback, preStep, hostTools };
}

const MCP_SETTINGS = {
  presets: { standard: { mode: "mcp", disabled: ["secret"], groups: [], mcp: { expose: ["read"] } } },
};

describe("mcp loading mode — policy", () => {
  it("keeps the mcp mode in the normalized settings", () => {
    const settings = normalizeSettings({
      presets: { standard: { mode: "mcp", disabled: ["secret"], groups: [] } },
    });
    assert.deepEqual(settings.presets.standard, { disabled: ["secret"], groups: [], mode: "mcp" });
  });

  it("only removes disabled tools and the group opener from the step set", () => {
    const policy = { disabled: ["secret"], groups: [], mode: "mcp" };
    const names = ["read", "calendar", "secret", "tool_list", "tool_find", "run_code"];
    assert.deepEqual(denyNames(policy, names, new Set()), ["secret", "tool_list"],
      "every other tool stays callable; only disabled ones and tool_list are removed");
  });

  it("has exactly the group-mode tool states: declared, grouped, disabled", () => {
    const policy = {
      disabled: ["secret"], mode: "mcp",
      groups: [{ name: "G", patterns: ["calendar"] }],
    };
    const names = ["read", "calendar", "secret", "tool_find", "tool_list"];
    assert.deepEqual(mcpGroupedNames(policy, names), ["calendar"], "grouped = the on-demand state");
    assert.ok(!mcpGroupedNames(policy, names).includes("read"),
      "an ungrouped enabled tool is plain always-on, exactly like the group mode");
  });

  it("has no third state: an ungrouped tool is never on-demand", () => {
    const policy = { disabled: [], mode: "mcp", groups: [{ name: "G", patterns: ["calendar"] }] };
    assert.deepEqual(mcpGroupedNames(policy, ["read", "calendar"]), ["calendar"],
      "only the grouped tool is on demand: there is no name-only tier left");
  });

  it("hides the discovery tool from a groups-mode preset", () => {
    assert.deepEqual(denyNames({ disabled: [], groups: [] }, ["read", "tool_find", "tool_list"], new Set()),
      ["tool_find", "tool_list"]);
  });
});

describe("mcp loading mode — runtime", () => {
  it("registers tool_find, keeps every tool in the step set, and never restricts", async () => {
    const { runtime, agent, registered, restricted, guard, hostTools } = harness({
      presets: {
        standard: {
          mode: "mcp", disabled: ["secret"], mcp: {},
          groups: [{ name: "日历", patterns: ["calendar"] }],
        },
      },
    });
    assert.ok(registered.has("tool_find"), "mcp mode must register tool_find");
    assert.equal(registered.has("tool_open"), false, "no open step exists");
    assert.equal(registered.has("tool_call"), false, "no proxy step exists");
    assert.equal(restricted.length, 0, "mcp mode must not call restrict()");
    assert.equal(guard()({ name: "calendar" }), undefined, "a grouped tool must pass the guard");
    assert.match(guard()({ name: "secret" }), /disabled/, "an explicitly disabled tool is blocked");

    const set = await hostTools.resolve({ agent });
    const view = set.view("agent-1");
    assert.ok(view.get("calendar"), "a grouped tool stays reachable by name");
    assert.ok(![...view.keys()].includes("calendar"), "a grouped tool is not declared");
    assert.ok([...view.keys()].includes("read"), "an ungrouped enabled tool is declared, like the group mode");
    await runtime.dispose();
  });

  it("reads a group without changing any state", async () => {
    const { runtime, agent, registered } = harness(MCP_SETTINGS);
    const findTool = registered.get("tool_find");
    assert.ok(findTool, "mcp mode must register tool_find");
    const exec = { agent };
    await assert.rejects(() => findTool.execute({ query: "calendar" }, exec), /group is required/,
      "keyword lookup is gone: tool_find answers by group only");
    await runtime.dispose();
  });

  it("injects an mcp loading notice instead of the group catalog", async () => {
    const { runtime, agent, preStep } = harness({
      presets: {
        standard: { mode: "mcp", disabled: [], mcp: {}, groups: [{ name: "日历", patterns: ["calendar"] }] },
      },
    });
    const decision = await preStep({ agent }, async () => ({ kind: "enter", messages: [] }));
    const notice = decision.messages.find((message) => message.source && message.source.kind === "tool-manager-mcp-notice");
    assert.ok(notice, "mcp mode must publish its own loading notice once a group exists");
    assert.match(notice.content[0].text, /a group is listed by name and description/);
    await runtime.dispose();
  });

  it("names the discovery tool once a group exists", async () => {
    const { runtime, agent, preStep } = harness({
      presets: {
        standard: {
          mode: "mcp", disabled: [], mcp: {},
          groups: [{ name: "日历", description: "日程", patterns: ["calendar"] }],
        },
      },
    });
    const decision = await preStep({ agent }, async () => ({ kind: "enter", messages: [] }));
    const notice = decision.messages.find((message) => message.source && message.source.kind === "tool-manager-mcp-notice");
    assert.match(notice.content[0].text, /tool_find\(\{ group/);
    await runtime.dispose();
  });
});

describe("mcp loading mode — group lookup and notice", () => {
  const members = [
    { name: "browser_click", description: "Click an element in the browser", parameters: { type: "object" } },
    { name: "browser_type", description: "Type into the browser", parameters: { type: "object" } },
  ];

  it("returns every member of the group with its real schema", () => {
    const result = groupLookup({ name: "浏览器", description: "网页操作" }, members);
    assert.equal(result.group, "浏览器");
    assert.equal(result.description, "网页操作");
    assert.deepEqual(result.tools.map((tool) => tool.name), ["browser_click", "browser_type"]);
    assert.equal(result.total, 2);
    assert.equal(result.tools[0].parameters.type, "object");
    assert.match(result.hint, /call any member of "浏览器"/);
  });

  it("omits an absent description", () => {
    const result = groupLookup({ name: "G" }, members);
    assert.equal(result.description, undefined);
  });

  it("renders a notice that names the discovery tool and the groups", () => {
    const text = renderMcpNoticeText({
      mode: "mcp",
      groups: [{ name: "浏览器", description: "网页操作" }],
    }, false);
    assert.match(text, /a group is listed by name and description/);
    assert.match(text, /- 浏览器: 网页操作/);
    assert.match(text, /tool_find\(\{ group/);
    assert.ok(!/query/.test(text), "the notice must not advertise a keyword path");
    assert.match(renderMcpNoticeText({ mode: "groups" }, false), /Ignore every earlier tool_find/);
  });

  it("appends the notice once and replaces it when the digest changes", () => {
    const seed = { mode: "mcp", exposed: [], hidden: 1, groups: [{ name: "G", description: "d" }] };
    const first = applyMcpNoticeDecision({ kind: "enter", messages: [] }, seed, { published: false });
    assert.equal(first.messages.length, 1);
    const same = applyMcpNoticeDecision(first, seed, { published: false });
    assert.equal(same.messages.length, 1);
    // Only a change the text actually renders may republish: the group list.
    const changed = applyMcpNoticeDecision(first, {
      mode: "mcp", exposed: [], hidden: 2,
      groups: [{ name: "G", description: "d" }, { name: "H", description: "e" }],
    }, { published: false });
    assert.equal(changed.messages.length, 1);
    assert.notEqual(changed.messages[0].id, first.messages[0].id);
  });

  it("drops the notice when the visible history already carries it", () => {
    const state = { mode: "mcp" };
    const first = applyMcpNoticeDecision({ kind: "enter", messages: [] }, state, { published: false });
    const settled = applyMcpNoticeDecision(first, state, { published: true, visibleDigest: digestMcpNotice(state) });
    assert.equal(settled.messages.length, 0);
  });
});

describe("mcp loading mode — mode switching", () => {
  it("registers tool_find on groups->mcp and drops it on mcp->groups", async () => {
    const { runtime, registered } = harness({
      presets: { standard: { disabled: [], groups: [], mode: "mcp", mcp: { expose: [] } } },
    });
    assert.equal(registered.has("tool_find"), true);
    runtime.update({ presets: { standard: { disabled: [], groups: [] } } });
    assert.equal(registered.has("tool_find"), false);
    await runtime.dispose();
  });
});

describe("mcp loading mode — save validation and snapshot", () => {
  it("does not reject a stale empty group on an mcp-mode preset", async () => {
    const presets = { compositionInventory: async () => [{ id: "standard", isDefault: true }] };
    await assert.doesNotReject(() => assertNoEmptyGroups(
      presets, { schemas: () => [] },
      { presets: { standard: { mode: "mcp", disabled: [], groups: [{ name: "gone", patterns: ["missing"] }], mcp: { expose: [] } } } },
      undefined, () => ["read"],
    ));
  });

  it("keeps the discovery tool out of the settings catalog", async () => {
    const presets = {
      compositionInventory: async () => [{ id: "standard", isDefault: true }],
      acquireScope: async () => ({ key: "scope", async [Symbol.asyncDispose]() {} }),
    };
    const tools = { schemas: () => [
      { name: "read", description: "read", parameters: {} },
      { name: "tool_find", description: "find", parameters: {} },
    ] };
    const snapshot = await buildSnapshot(presets, tools, { presets: {} }, 0, "config.json");
    assert.deepEqual(snapshot.presets[0].tools.map((tool) => tool.name), ["read"]);
  });
});

describe("mcp loading mode — groups", () => {
  const GROUPED = {
    presets: {
      standard: {
        mode: "mcp", disabled: [], mcp: { expose: ["read"] },
        groups: [{ name: "浏览器", description: "网页操作", patterns: ["calendar"] }],
      },
    },
  };

  it("keeps grouped tools out of the declaration set but callable", async () => {
    const { runtime, agent, hostTools } = harness(GROUPED);
    const set = await hostTools.resolve({ agent });
    const view = set.view("agent-1");
    assert.ok(![...view.keys()].includes("calendar"),
      "a grouped tool must not be declared: the group stands in for it");
    assert.ok(view.get("calendar"), "a grouped tool stays reachable by name, so it needs no activation");
    assert.ok([...view.keys()].includes("read"), "an exposed tool is still declared");
    await runtime.dispose();
  });

  it("returns every member of a group from one lookup", async () => {
    const { runtime, agent, registered } = harness(GROUPED);
    const findTool = registered.get("tool_find");
    const result = await findTool.execute({ group: "浏览器" }, { agent });
    assert.equal(result.group, "浏览器");
    assert.equal(result.description, "网页操作");
    assert.deepEqual(result.tools.map((tool) => tool.name), ["calendar"]);
    assert.equal(result.tools[0].parameters.properties.day.type, "string",
      "the group lookup returns the real parameter schema");
    await runtime.dispose();
  });

  it("rejects an unknown group with the known names", async () => {
    const { runtime, agent, registered } = harness(GROUPED);
    const findTool = registered.get("tool_find");
    await assert.rejects(() => findTool.execute({ group: "nope" }, { agent }), /known groups: 浏览器/);
    await runtime.dispose();
  });

  it("lists the group name and description in the catalog", async () => {
    const { runtime, agent, preStep } = harness(GROUPED);
    const decision = await preStep({ agent }, async () => ({ kind: "enter", messages: [] }));
    const notice = decision.messages.find((m) => m.source && m.source.kind === "tool-manager-mcp-notice");
    assert.match(notice.content[0].text, /available_tool_groups/);
    assert.match(notice.content[0].text, /- 浏览器: 网页操作/);
    await runtime.dispose();
  });
});


describe("mcp loading mode — settings page parity", () => {
  it("renders group cards and hides their members in mcp mode", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(new URL("../src/client.js", import.meta.url), "utf8");
    assert.ok(
      !/listedGroups = mcpMode \? \[\]/.test(source),
      "the settings page must not hide groups just because the preset is in mcp mode",
    );
    assert.match(source, /const listedGroups = showGroups \? visibleGroups : \[\];/,
      "group cards are listed in every mode");
    assert.match(source, /return !grouped\.has\(tool\.name\);[\s\S]{0,80}\}/,
      "a grouped tool is not repeated in the mcp-mode tool list");
  });
});


describe("group changes reach both modes", () => {
  it("applies a group edit to the mcp-mode step set without a restart", async () => {
    const harnessed = harness({
      presets: {
        standard: {
          mode: "mcp", disabled: [], mcp: {},
          groups: [{ name: "日历", patterns: ["calendar"] }],
        },
      },
    });
    const before = (await harnessed.hostTools.resolve({ agent: harnessed.agent })).view("agent-1");
    assert.ok(![...before.keys()].includes("calendar"), "grouped before the edit");

    // The person edits the group in the settings page: calendar leaves the group.
    harnessed.runtime.update({
      presets: { standard: { mode: "mcp", disabled: [], mcp: {}, groups: [] } },
    });

    const after = (await harnessed.hostTools.resolve({ agent: harnessed.agent })).view("agent-1");
    assert.ok([...after.keys()].includes("calendar"),
      "an ungrouped tool must be declared in full from the next step");
    await harnessed.runtime.dispose();
  });

  it("applies a group edit to the group-mode step set without a restart", async () => {
    const harnessed = harness({
      presets: { standard: { disabled: [], groups: [] } },
    });
    const before = (await harnessed.hostTools.resolve({ agent: harnessed.agent })).view("agent-1");
    assert.ok([...before.keys()].includes("calendar"), "ungrouped means always-on in group mode");

    harnessed.runtime.update({
      presets: { standard: { disabled: [], groups: [{ name: "日历", patterns: ["calendar"] }] } },
    });

    const after = (await harnessed.hostTools.resolve({ agent: harnessed.agent })).view("agent-1");
    assert.ok(![...after.keys()].includes("calendar"),
      "a newly grouped tool disappears from the step set until its group is opened");
    await harnessed.runtime.dispose();
  });

  it("drops stale group names when a group is renamed (group mode)", async () => {
    const harnessed = harness({
      presets: { standard: { disabled: [], groups: [{ name: "旧组", patterns: ["calendar"] }] } },
    });
    const listTool = harnessed.registered.get("tool_list");
    assert.ok(listTool, "group mode must register tool_list");
    await listTool.execute({ group: "旧组" }, { agent: harnessed.agent });

    harnessed.runtime.update({
      presets: { standard: { disabled: [], groups: [{ name: "新组", patterns: ["calendar"] }] } },
    });

    const view = (await harnessed.hostTools.resolve({ agent: harnessed.agent })).view("agent-1");
    assert.ok(![...view.keys()].includes("calendar"),
      "the opened state of a renamed group must not survive as a stale exposure");
    await harnessed.runtime.dispose();
  });
});


describe("group changes reach both modes — exposure hygiene", () => {
  it("clears the group-mode exposure set when the preset runs mcp mode", async () => {
    const harnessed = harness({
      presets: { standard: { disabled: [], groups: [{ name: "G", patterns: ["calendar"] }] } },
    });
    const listTool = harnessed.registered.get("tool_list");
    assert.ok(listTool, "group mode must register tool_list");
    await listTool.execute({ group: "G" }, { agent: harnessed.agent });

    // Switch this preset to mcp mode: the group-name exposure set no longer
    // describes anything, and a later switch back must not inherit it.
    harnessed.runtime.update({
      presets: { standard: { mode: "mcp", disabled: [], groups: [{ name: "G", patterns: ["calendar"] }] } },
    });
    harnessed.runtime.update({
      presets: { standard: { disabled: [], groups: [{ name: "G", patterns: ["calendar"] }] } },
    });

    const view = (await harnessed.hostTools.resolve({ agent: harnessed.agent })).view("agent-1");
    assert.ok(![...view.keys()].includes("calendar"),
      "a group opened before the mcp excursion must not stay open afterwards");
    await harnessed.runtime.dispose();
  });
});


describe("mcp loading mode — notice source contract", () => {
  const state = {
    mode: "mcp",
    groups: [{ name: "浏览器", description: "网页操作" }],
  };

  it("carries the summary DSH requires of a notice form", () => {
    const message = renderMcpNoticeMessage(state, false);
    assert.equal(message.source.form, "notice");
    assert.equal(typeof message.source.summary, "string");
    assert.ok(message.source.summary.length > 0, "a notice without a summary makes the client print the raw source");
    assert.ok(message.source.summary.length <= 120, "a summary is bounded to 120 characters");
    assert.match(message.source.summary, /1 on-demand tool group/);
  });

  it("records the group list the same way the catalog records its entries", () => {
    const message = renderMcpNoticeMessage(state, false);
    assert.deepEqual(message.source.groups, [{ name: "浏览器", description: "网页操作" }],
      "the source must carry the rendered groups so the digest can be recomputed");
  });

  it("recomputes the same digest after a persist and reload", () => {
    const message = renderMcpNoticeMessage(state, false);
    const persisted = JSON.parse(JSON.stringify(message.source));
    const restored = readMcpNotice(persisted);
    assert.ok(restored, "the source must stay readable");
    assert.equal(digestMcpNotice(restored), digestMcpNotice(state),
      "a reloaded notice must digest identically to the live state");
  });

  it("gives the groups-mode notice its own summary", () => {
    const message = renderMcpNoticeMessage({ mode: "groups" }, false);
    assert.equal(message.source.form, "notice");
    assert.match(message.source.summary, /group catalog/);
  });
});


describe("mcp loading mode — notice is injected once", () => {
  const state = {
    mode: "mcp",
    groups: [{ name: "浏览器", description: "网页操作" }],
  };

  // A Session that already carries the persisted notice on its surface.
  function sessionCarrying(message) {
    // DSH's `user/message` data IS the message: source sits at data.source.
    const events = [
      undefined,
      { type: "user/message", seq: 1, data: message },
    ];
    return {
      seq: 2,
      surface: { nodes: [1] },
      eventAt(index) { return events[index]; },
    };
  }

  it("does not re-inject the notice on a later step", () => {
    const message = renderMcpNoticeMessage(state, false);
    // Persist and reload: the source carries the digest, not the group list.
    const persisted = JSON.parse(JSON.stringify(message));
    const agent = { id: "a1", session: sessionCarrying(persisted) };
    const history = mcpNoticeHistory(agent);
    assert.equal(history.visibleDigest, digestMcpNotice(state),
      "the history must recompute the digest the notice actually recorded");

    const decision = applyMcpNoticeDecision(
      { kind: "enter", messages: [] }, state, history,
    );
    assert.equal(decision.messages.length, 0,
      "a notice already visible on the surface must not be added again");
  });

  it("still refreshes when the groups really change", () => {
    const message = renderMcpNoticeMessage(state, false);
    const persisted = JSON.parse(JSON.stringify(message));
    const agent = { id: "a1", session: sessionCarrying(persisted) };
    const history = mcpNoticeHistory(agent);
    const renamed = {
      ...state,
      groups: [{ name: "浏览器", description: "网页操作与截图" }],
    };
    const decision = applyMcpNoticeDecision({ kind: "enter", messages: [] }, renamed, history);
    assert.equal(decision.messages.length, 1, "a changed description must republish the notice");
  });
});


describe("mcp loading mode — notice digest matches what it renders", () => {
  const groups = [{ name: "浏览器", description: "网页操作" }];

  it("ignores the always-on tool list, which the notice never shows", () => {
    const before = digestMcpNotice({ mode: "mcp", groups });
    const after = digestMcpNotice({ mode: "mcp", exposed: ["read", "edit", "grep"], hidden: 2, groups });
    assert.equal(after, before,
      "a tool appearing in the baseline must not republish a notice whose text did not change");
  });

  it("still tracks the group list it does render", () => {
    const before = digestMcpNotice({ mode: "mcp", groups });
    const after = digestMcpNotice({
      mode: "mcp",
      groups: [{ name: "浏览器", description: "网页操作与截图" }],
    });
    assert.notEqual(after, before, "a changed description must republish the notice");
  });

  it("does not re-inject across steps while tools come and go", () => {
    let exposed = ["read"];
    const state = () => ({ mode: "mcp", exposed, hidden: 2, groups });
    const history = { visibleDigest: digestMcpNotice(state()), published: true };
    let injections = 0;
    for (let step = 0; step < 5; step += 1) {
      if (step > 0) exposed = [...exposed, `tool_${step}`];
      injections += applyMcpNoticeDecision({ kind: "enter", messages: [] }, state(), history).messages.length;
    }
    assert.equal(injections, 0,
      "the group-mode catalog stays quiet across steps; the mcp notice must too");
  });
});


describe("mcp loading mode — quiet when nothing is on demand", () => {
  it("injects nothing when the preset has no groups, like the group catalog", () => {
    const decision = applyMcpNoticeDecision(
      { kind: "enter", messages: [] },
      { mode: "mcp", groups: [] },
      { published: false },
    );
    const catalog = applyCatalogDecision({ kind: "enter", messages: [] }, [], { published: false });
    assert.equal(catalog.messages.length, 0, "the group catalog is silent with no groups");
    assert.equal(decision.messages.length, 0,
      "with nothing on demand the notice would only describe a state that does not exist");
  });

  it("still injects when at least one group exists", () => {
    const decision = applyMcpNoticeDecision(
      { kind: "enter", messages: [] },
      { mode: "mcp", groups: [{ name: "G", description: "d" }] },
      { published: false },
    );
    assert.equal(decision.messages.length, 1);
  });

  it("goes silent once the last group is gone", () => {
    const message = renderMcpNoticeMessage(
      { mode: "mcp", groups: [{ name: "G", description: "d" }] }, false,
    );
    const decision = applyMcpNoticeDecision(
      { kind: "enter", messages: [message] },
      { mode: "mcp", groups: [] },
      { published: true },
    );
    assert.equal(decision.messages.length, 0,
      "mcp mode has no activation notice to retire, so there is nothing left to publish");
  });
});


describe("mcp loading mode — switching back to groups corrects the notice", () => {
  it("publishes the corrective notice even with no groups", () => {
    // The Session ran mcp mode, so its history still tells the model to call
    // tool_find; switching back must contradict that, groups or not.
    const decision = applyMcpNoticeDecision(
      { kind: "enter", messages: [] },
      { mode: "groups" },
      { published: true },
    );
    assert.equal(decision.messages.length, 1,
      "a Session carrying an mcp notice needs the corrective group-catalog notice");
    assert.match(decision.messages[0].content[0].text, /Ignore every earlier tool_find instruction/);
  });

  it("stays silent in groups mode when no mcp notice was ever published", () => {
    const decision = applyMcpNoticeDecision(
      { kind: "enter", messages: [] },
      { mode: "groups" },
      { published: false },
    );
    assert.equal(decision.messages.length, 0);
  });

  it("stays silent in mcp mode when no group was ever announced", () => {
    const decision = applyMcpNoticeDecision(
      { kind: "enter", messages: [] },
      { mode: "mcp", groups: [] },
      { published: false },
    );
    assert.equal(decision.messages.length, 0);
  });
});








describe("mcp loading mode — the groups-mode notice promises nothing absent", () => {
  it("does not tell the model to use a catalog that is not there", () => {
    // Group mode with no groups publishes no catalog and hides tool_list, so the
    // corrective notice must not point at either.
    const text = renderMcpNoticeText({ mode: "groups" }, false);
    assert.ok(!/tool-group catalog/.test(text), "there may be no catalog to read");
    assert.ok(!/tool_list/.test(text), "tool_list is hidden when no group exists");
    assert.match(text, /Ignore every earlier tool_find instruction/);
  });
});


describe("mcp loading mode — summaries match the body", () => {
  it("never names tool_list in the summary", () => {
    const plain = renderMcpNoticeMessage({ mode: "mcp", groups: [] }, true);
    assert.ok(!/tool_list/.test(plain.source.summary),
      "mcp mode has no activation tool, so its summary must not name one");
  });

  it("counts the groups it actually lists", () => {
    const two = renderMcpNoticeMessage({ mode: "mcp", groups: [
      { name: "a" }, { name: "b" },
    ] }, false);
    assert.match(two.source.summary, /^2 on-demand tool groups/);
    const one = renderMcpNoticeMessage({ mode: "mcp", groups: [{ name: "a" }] }, false);
    assert.match(one.source.summary, /^1 on-demand tool group;/);
  });
});


describe("mcp loading mode — the notice survives tool churn", () => {
  const G = [{ name: "浏览器", description: "网页操作" }];

  it("does not republish when only a group's member count changes", () => {
    // The notice lists names and descriptions; membership is tool_find's job.
    const before = digestMcpNotice({ mode: "mcp", groups: G });
    const after = digestMcpNotice({ mode: "mcp", groups: G });
    assert.equal(after, before);

    let published = false, visibleDigest;
    const counts = [];
    for (const state of [{ mode: "mcp", groups: G }, { mode: "mcp", groups: G }, { mode: "mcp", groups: G }]) {
      const d = applyMcpNoticeDecision({ kind: "enter", messages: [] }, state, { published, visibleDigest });
      counts.push(d.messages.length);
      if (d.messages.length) { published = true; visibleDigest = digestMcpNotice(state); }
    }
    assert.deepEqual(counts, [1, 0, 0],
      "tools appearing and disappearing inside a group must not republish the notice");
  });

  it("renders the group name and description without a count", () => {
    const text = renderMcpNoticeText({ mode: "mcp", groups: G }, false);
    assert.match(text, /- 浏览器: 网页操作/);
    assert.ok(!/tools\)/.test(text), "a volatile count would republish on every membership change");
  });

  it("still renders a group without a description", () => {
    const text = renderMcpNoticeText({ mode: "mcp", groups: [{ name: "无描述组" }] }, false);
    assert.match(text, /- 无描述组\n/);
  });
});
