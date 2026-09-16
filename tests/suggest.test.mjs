import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildAutoGroupPrompt,
  buildSuggestionPrompt,
  generateAutoGroups,
  generateGroupSuggestion,
  normalizeGroupNames,
  parseAutoGroupResult,
  parseGroupSuggestion,
  selectSuggestionTools,
  validateGenerationTimeout,
} from "../dist/suggest.js";

const tools = [
  { name: "web_search", description: "Search the web", parameters: {} },
  { name: "web_fetch", description: "Fetch one web page", parameters: {} },
  { name: "read", description: "Read a local file", parameters: {} },
];

describe("tool-manager group suggestions", () => {
  it("selects only known requested tools in request order", () => {
    assert.deepEqual(selectSuggestionTools(tools, ["web_fetch", "web_search", "web_fetch"]), [tools[1], tools[0]]);
    assert.throws(() => selectSuggestionTools(tools, []), /至少选择一个工具/);
    assert.throws(() => selectSuggestionTools(tools, ["missing"]), /不存在或已变化/);
  });

  it("builds a bounded prompt from selected tools only", () => {
    const prompt = buildSuggestionPrompt({ tools: [tools[0]], otherGroupNames: ["已有分组"] });
    assert.match(prompt, /web_search/);
    assert.doesNotMatch(prompt, /web_fetch/);
    assert.match(prompt, /已有分组/);
    assert.doesNotMatch(prompt, /parameters/);
  });

  it("parses plain and fenced JSON suggestions", () => {
    assert.deepEqual(parseGroupSuggestion('{"name":" 网络工具 ","description":" 搜索与读取网页。 "}'), {
      name: "网络工具",
      description: "搜索与读取网页。",
    });
    assert.deepEqual(parseGroupSuggestion('```json\n{"name":"网页助手","description":"处理网页内容。"}\n```'), {
      name: "网页助手",
      description: "处理网页内容。",
    });
    assert.throws(() => parseGroupSuggestion("not json"), /不是有效 JSON/);
    assert.throws(() => parseGroupSuggestion('{"name":"空描述","description":""}'), /名称或描述为空/);
  });

  it("normalizes existing group names", () => {
    assert.deepEqual(normalizeGroupNames([" Web  工具 ", "Web  工具", ""]), ["Web 工具"]);
    assert.throws(() => normalizeGroupNames("bad"), /must be an array/);
  });

  it("uses the current default model and accepts a text block", async () => {
    let options;
    const llm = {
      async *stream(value) {
        options = value;
        yield { type: "block-start", index: 0, blockType: "text" };
        yield { type: "text-delta", index: 0, text: '{"name":"网络检索","description":"搜索并读取网页资料。"}' };
        yield { type: "block-end", index: 0, block: { type: "text", text: '{"name":"网络检索","description":"搜索并读取网页资料。"}' } };
        yield { type: "finish", reason: { kind: "stop" } };
      },
    };
    const result = await generateGroupSuggestion(llm, {
      currentSelection: () => ({ provider: "deepseek", model: "chat", reasoningEffort: "low" }),
    }, { tools: tools.slice(0, 2), otherGroupNames: [] });
    assert.deepEqual(result, { name: "网络检索", description: "搜索并读取网页资料。" });
    assert.equal(options.provider, "deepseek");
    assert.equal(options.model, "chat");
    assert.equal(options.reasoningEffort, "low");
    assert.equal(options.tools, undefined);
  });

  it("rejects duplicate names, tool calls, and terminal model errors", async () => {
    const response = (chunks) => ({ async *stream() { yield* chunks; } });
    await assert.rejects(() => generateGroupSuggestion(response([
      { type: "text-delta", index: 0, text: '{"name":"已有分组","description":"说明"}' },
      { type: "finish", reason: { kind: "stop" } },
    ]), { currentSelection: () => ({ provider: "p", model: "m" }) }, {
      tools: [tools[0]], otherGroupNames: ["已有分组"],
    }), /与现有分组重复/);

    await assert.rejects(() => generateGroupSuggestion(response([
      { type: "block-start", index: 0, blockType: "tool-call" },
      { type: "finish", reason: { kind: "tool-calls" } },
    ]), { currentSelection: () => ({ provider: "p", model: "m" }) }, {
      tools: [tools[0]], otherGroupNames: [],
    }), /返回了工具调用/);

    await assert.rejects(() => generateGroupSuggestion(response([
      { type: "finish", reason: { kind: "error", failure: { message: "provider unavailable" } } },
    ]), { currentSelection: () => ({ provider: "p", model: "m" }) }, {
      tools: [tools[0]], otherGroupNames: [],
    }), /provider unavailable/);
  });

  it("builds an auto-group prompt without parameter schemas", () => {
    const prompt = buildAutoGroupPrompt({ tools, otherGroupNames: ["已有组"] });
    assert.match(prompt, /web_search/);
    assert.match(prompt, /已有组/);
    assert.match(prompt, /ungrouped/);
    assert.doesNotMatch(prompt, /parameters/);
  });

  it("parses multiple groups and fills omitted ungrouped tools", () => {
    const result = parseAutoGroupResult(JSON.stringify({
      groups: [
        { name: "网页研究", description: "检索并读取网页。", tools: ["web_search", "web_fetch"] },
      ],
      ungrouped: [],
    }), tools.map((tool) => tool.name), []);
    assert.deepEqual(result, {
      groups: [{ name: "网页研究", description: "检索并读取网页。", tools: ["web_search", "web_fetch"] }],
      ungrouped: ["read"],
    });
  });

  it("rejects invalid auto-group assignments", () => {
    assert.throws(() => parseAutoGroupResult(JSON.stringify({
      groups: [
        { name: "A", description: "A", tools: ["web_search"] },
        { name: "B", description: "B", tools: ["web_search"] },
      ],
      ungrouped: [],
    }), tools.map((tool) => tool.name), []), /被分到多个组/);
    assert.throws(() => parseAutoGroupResult(JSON.stringify({
      groups: [{ name: "已有组", description: "冲突", tools: ["read"] }], ungrouped: [],
    }), tools.map((tool) => tool.name), ["已有组"]), /与现有分组重复/);
    assert.throws(() => parseAutoGroupResult(JSON.stringify({
      groups: [{ name: "未知", description: "未知", tools: ["missing"] }], ungrouped: [],
    }), tools.map((tool) => tool.name), []), /未知工具/);
    assert.throws(() => parseAutoGroupResult('{"groups":[],"ungrouped":["read"]}', tools.map((tool) => tool.name), []), /没有生成任何有效分组/);
  });

  it("generates bulk groups with the default model", async () => {
    let options;
    const llm = {
      async *stream(value) {
        options = value;
        yield { type: "text-delta", index: 0, text: '```json\n{"groups":[{"name":"网页研究","description":"检索网页内容。","tools":["web_search","web_fetch"]}],"ungrouped":["read"]}\n```' };
        yield { type: "finish", reason: { kind: "stop" } };
      },
    };
    const result = await generateAutoGroups(llm, {
      currentSelection: () => ({ provider: "deepseek", model: "chat" }),
    }, { tools, otherGroupNames: [] });
    assert.equal(result.groups[0].name, "网页研究");
    assert.deepEqual(result.ungrouped, ["read"]);
    assert.equal(options.maxTokens, 1600);
  });

  it("validates configurable generation timeouts", () => {
    assert.equal(validateGenerationTimeout(5_000), 5_000);
    assert.equal(validateGenerationTimeout(600_000), 600_000);
    assert.throws(() => validateGenerationTimeout(4_999), /between 5000 and 600000/);
    assert.throws(() => validateGenerationTimeout(600_001), /between 5000 and 600000/);
    assert.throws(() => validateGenerationTimeout(30.5), /integer/);
  });

  it("reports local and provider aborts clearly", async () => {
    const delayed = {
      async *stream(options) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 100);
          options.signal.addEventListener("abort", () => {
            clearTimeout(timer);
            const error = new Error("This operation was aborted");
            error.name = "AbortError";
            reject(error);
          }, { once: true });
        });
      },
    };
    await assert.rejects(() => generateGroupSuggestion(delayed, {
      currentSelection: () => ({ provider: "p", model: "m" }),
    }, { tools: [tools[0]], otherGroupNames: [] }, 5), /between 5000 and 600000/);

    const providerAbort = {
      async *stream() {
        const error = new Error("This operation was aborted");
        error.name = "AbortError";
        throw error;
      },
    };
    await assert.rejects(() => generateGroupSuggestion(providerAbort, {
      currentSelection: () => ({ provider: "p", model: "m" }),
    }, { tools: [tools[0]], otherGroupNames: [] }, 5_000), /被模型服务中止/);
  });

  it("requires a configured default model", async () => {
    await assert.rejects(() => generateGroupSuggestion({ async *stream() {} }, {
      currentSelection: () => ({ provider: "", model: "" }),
    }, { tools: [tools[0]], otherGroupNames: [] }), /没有配置默认模型/);
  });
});
