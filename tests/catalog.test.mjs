import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  applyCatalogDecision,
  catalogEntriesFromGroups,
  catalogHistory,
  catalogMessage,
  CATALOG_SOURCE_KIND,
  digestCatalogEntries,
  readCatalogEntries,
  renderCatalogMessage,
  renderCatalogText,
} from "../dist/catalog.js";

const groups = [
  { name: "GitHub MCP", description: "GitHub tools", tools: ["mcp__github__issue", "mcp__github__pull"] },
  { name: "搜索工具", tools: ["web_search"] },
];

describe("tool-manager catalog", () => {
  it("projects group names and empty descriptions", () => {
    assert.deepEqual(catalogEntriesFromGroups(groups), [
      {
        name: "GitHub MCP",
        description: "GitHub tools",
        tools: ["mcp__github__issue", "mcp__github__pull"],
      },
      { name: "搜索工具", description: "", tools: ["web_search"] },
    ]);
    assert.deepEqual(catalogEntriesFromGroups([
      ...groups,
      { name: "空组", description: "ignored", tools: [] },
    ]).map((entry) => entry.name), ["GitHub MCP", "搜索工具"]);
  });

  it("digests entries, not framing prose", () => {
    const entries = catalogEntriesFromGroups(groups);
    const expected = createHash("sha256")
      .update(entries.map((entry) => JSON.stringify([entry.name, entry.description, entry.tools])).join("\n"))
      .digest("hex");
    assert.equal(digestCatalogEntries(entries), expected);
    assert.equal(digestCatalogEntries(entries), digestCatalogEntries([...entries]));
    assert.notEqual(
      digestCatalogEntries(entries),
      digestCatalogEntries([{ name: "GitHub MCP", description: "other", tools: ["mcp__github__issue"] }]),
    );
    assert.notEqual(
      digestCatalogEntries(entries),
      digestCatalogEntries(entries.map((entry, index) => index === 0
        ? { ...entry, tools: [...entry.tools, "mcp__github__repo"] }
        : entry)),
    );
  });

  it("renders a first-publish reminder with group names", () => {
    const text = renderCatalogText(catalogEntriesFromGroups(groups), false);
    assert.match(text, /^<system-reminder>\n/);
    assert.match(text, /Some tools are organized into on-demand groups and can be opened when needed\./);
    assert.doesNotMatch(text, /not in the current tool list/);
    assert.match(text, /<available_tool_groups>/);
    assert.match(text, /- GitHub MCP \(2 tools\): GitHub tools/);
    assert.match(text, /Tools: mcp__github__issue, mcp__github__pull/);
    assert.match(text, /- 搜索工具 \(1 tools\)\n  Tools: web_search/);
    assert.match(text, /tool_list\(\{ group: "<name>" \}\)/);
    assert.doesNotMatch(text, /PTC/);
    assert.doesNotMatch(text, /replaces every earlier/);
  });

  it("renders a replacement catalog and an empty retirement", () => {
    const update = renderCatalogText(catalogEntriesFromGroups(groups), true);
    assert.match(update, /replaces every earlier tool-group list/);
    assert.match(update, /Use only names in this replacement catalog/);
    assert.doesNotMatch(update, /PTC/);
    const empty = renderCatalogText([], true);
    assert.match(empty, /No on-demand tool groups are currently available/);
    assert.doesNotMatch(empty, /Use only names in this replacement catalog/);
  });

  it("escapes group names, descriptions, and tool names in the model-facing frame", () => {
    const text = renderCatalogText([{
      name: "A<B>",
      description: "x&y",
      tools: ["tool<a>", "tool&b"],
    }], false);
    assert.match(text, /- A&lt;B&gt; \(2 tools\): x&amp;y/);
    assert.match(text, /Tools: tool&lt;a&gt;, tool&amp;b/);
    assert.doesNotMatch(text, /A<B>/);
  });

  it("builds a frozen user-role catalog message", () => {
    const entries = catalogEntriesFromGroups(groups);
    const message = renderCatalogMessage(entries, false);
    assert.equal(message.role, "user");
    assert.equal(typeof message.id, "string");
    assert.equal(message.id.length > 0, true);
    assert.equal(message.source.kind, CATALOG_SOURCE_KIND);
    assert.equal(message.source.form, "catalog");
    assert.equal(message.source.update, undefined);
    assert.deepEqual(message.source.entries, entries);
    assert.equal(message.content[0]?.type, "text");
    assert.equal(Object.isFrozen(message), true);
    const updated = renderCatalogMessage([], true);
    assert.equal(updated.source.update, true);
  });

  it("reads only well-formed catalog sources", () => {
    const entries = [{ name: "GitHub MCP", description: "GitHub tools", tools: ["mcp__github__issue"] }];
    assert.deepEqual(readCatalogEntries({ kind: CATALOG_SOURCE_KIND, entries }), entries);
    assert.deepEqual(
      readCatalogEntries({ kind: CATALOG_SOURCE_KIND, entries: [{ name: "old", description: "legacy" }] }),
      [{ name: "old", description: "legacy", tools: [] }],
    );
    assert.equal(readCatalogEntries({ kind: "skill-catalog", entries }), undefined);
    assert.equal(readCatalogEntries({ kind: CATALOG_SOURCE_KIND, entries: [{ name: "x" }] }), undefined);
    assert.equal(readCatalogEntries({ kind: CATALOG_SOURCE_KIND, entries: [{ name: "x", description: "", tools: [1] }] }), undefined);
    assert.equal(readCatalogEntries({ kind: CATALOG_SOURCE_KIND, entries: "nope" }), undefined);
  });

  it("finds a catalog already present in this step", () => {
    const message = renderCatalogMessage(catalogEntriesFromGroups(groups), false);
    const found = catalogMessage([
      { id: "user-1", role: "user", content: [], source: { kind: "user" } },
      message,
    ]);
    assert.equal(found?.message.id, message.id);
    assert.deepEqual(found?.entries, message.source.entries);
    assert.equal(catalogMessage([{ source: { kind: "user" } }]), undefined);
  });

  it("reads visible catalog history and ignores compacted copies", () => {
    const entries = catalogEntriesFromGroups(groups);
    const agent = {
      ctx: { get() {}, on() {} },
      session: {
        seq: 3,
        surface: { nodes: [2] },
        eventAt(seq) {
          if (seq === 1) {
            return {
              type: "user/message",
              seq: 1,
              data: {
                source: { kind: CATALOG_SOURCE_KIND, entries: [{ name: "old", description: "", tools: ["old_tool"] }] },
              },
            };
          }
          if (seq === 2) {
            return {
              type: "user/message",
              seq: 2,
              data: { source: { kind: CATALOG_SOURCE_KIND, entries } },
            };
          }
          return undefined;
        },
      },
    };
    assert.deepEqual(catalogHistory(agent), {
      published: true,
      visibleDigest: digestCatalogEntries(entries),
    });
    assert.deepEqual(catalogHistory({ ctx: { get() {}, on() {} } }), { published: false });
  });

  it("injects a first catalog and skips republish when the digest is visible", () => {
    const entries = catalogEntriesFromGroups(groups);
    const first = applyCatalogDecision(
      { kind: "enter", messages: [{ id: "u1", source: { kind: "user" } }] },
      entries,
      { published: false },
    );
    assert.equal(first.messages.length, 2);
    assert.equal(first.messages[1]?.source.kind, CATALOG_SOURCE_KIND);
    assert.equal(first.messages[1]?.source.update, undefined);

    const skipped = applyCatalogDecision(
      { kind: "enter", messages: [{ id: "u2", source: { kind: "user" } }] },
      entries,
      { published: true, visibleDigest: digestCatalogEntries(entries) },
    );
    assert.equal(skipped.messages.length, 1);
    assert.equal(skipped.messages[0]?.id, "u2");
  });

  it("replaces an in-step catalog and retires names when groups disappear", () => {
    const existing = renderCatalogMessage([{ name: "old", description: "", tools: ["old_tool"] }], false);
    const replaced = applyCatalogDecision(
      { kind: "enter", messages: [existing] },
      catalogEntriesFromGroups(groups),
      { published: true },
    );
    assert.equal(replaced.messages.length, 1);
    assert.notEqual(replaced.messages[0]?.id, existing.id);
    assert.equal(replaced.messages[0]?.source.update, true);
    assert.match(replaced.messages[0]?.content[0]?.text ?? "", /GitHub MCP/);

    const retired = applyCatalogDecision(
      { kind: "enter", messages: [{ id: "u3", source: { kind: "user" } }] },
      [],
      { published: true },
    );
    assert.equal(retired.messages.length, 2);
    assert.equal(retired.messages[1]?.source.update, true);
    assert.deepEqual(retired.messages[1]?.source.entries, []);

    const never = applyCatalogDecision(
      { kind: "enter", messages: [{ id: "u4", source: { kind: "user" } }] },
      [],
      { published: false },
    );
    assert.equal(never.messages.length, 1);
    assert.equal(never.messages[0]?.id, "u4");
  });

  it("drops a duplicate in-step catalog when history already shows the same digest", () => {
    const entries = catalogEntriesFromGroups(groups);
    const existing = renderCatalogMessage(entries, false);
    const dropped = applyCatalogDecision(
      { kind: "enter", messages: [{ id: "u5", source: { kind: "user" } }, existing] },
      entries,
      { published: true, visibleDigest: digestCatalogEntries(entries) },
    );
    assert.deepEqual(dropped.messages.map((message) => message.id), ["u5"]);
  });

  it("leaves reject decisions untouched", () => {
    const reject = { kind: "reject" };
    assert.equal(applyCatalogDecision(reject, catalogEntriesFromGroups(groups), { published: false }), reject);
  });
});
