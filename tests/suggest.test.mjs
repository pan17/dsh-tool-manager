import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildAutoGroupPrompt,
  buildSuggestionPrompt,
  generateAutoGroups,
  generateGroupSuggestion,
  normalizeCustomPrompt,
  normalizeGroupNames,
  parseAutoGroupResult,
  parseGroupSuggestion,
  resolveGenerationSelection,
  selectSuggestionTools,
  validateGenerationTimeout,
} from "../dist/suggest.js";

const tools = [
  { name: "web_search", description: "Search the web", parameters: {} },
  { name: "web_fetch", description: "Fetch one web page", parameters: {} },
  { name: "read", description: "Read a local file", parameters: {} },
];

describe("tool-manager group suggestions", () => {
  it("selects all known requested tools in request order without a count limit", () => {
    assert.deepEqual(selectSuggestionTools(tools, ["web_fetch", "web_search", "web_fetch"]), [tools[1], tools[0]]);
    const manyTools = Array.from({ length: 200 }, (_, index) => ({
      name: `tool_${index}`,
      description: `Tool ${index}`,
      parameters: {},
    }));
    assert.equal(selectSuggestionTools(manyTools, manyTools.map((tool) => tool.name)).length, 200);
    assert.throws(() => selectSuggestionTools(tools, []), /至少选择一个工具/);
    assert.throws(() => selectSuggestionTools(tools, ["missing"]), /不存在或已变化/);
  });

  it("builds a prompt from selected tools only without truncating metadata", () => {
    const longName = `tool_${"n".repeat(300)}`;
    const longDescription = `description_${"d".repeat(1_000)}`;
    const longGroupName = `已有分组_${"g".repeat(300)}`;
    const prompt = buildSuggestionPrompt({
      tools: [{ name: longName, description: longDescription, parameters: {} }],
      otherGroupNames: [longGroupName],
    });
    assert.match(prompt, new RegExp(longName));
    assert.match(prompt, new RegExp(longDescription));
    assert.match(prompt, new RegExp(longGroupName));
    assert.doesNotMatch(prompt, /web_fetch/);
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
    const longName = `名称_${"名".repeat(100)}`;
    const longDescription = `描述_${"述".repeat(500)}`;
    assert.deepEqual(parseGroupSuggestion(JSON.stringify({ name: longName, description: longDescription })), {
      name: longName,
      description: longDescription,
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

  it("parses groups without count, name, or description length limits", () => {
    const manyTools = Array.from({ length: 40 }, (_, index) => `tool_${index}`);
    const longName = `长名称_${"名".repeat(100)}`;
    const longDescription = `长描述_${"述".repeat(500)}`;
    const groups = manyTools.map((toolName, index) => ({
      name: index === 0 ? longName : `分组_${index}`,
      description: index === 0 ? longDescription : `描述_${index}`,
      tools: [toolName],
    }));
    const result = parseAutoGroupResult(JSON.stringify({ groups, ungrouped: [] }), manyTools, []);
    assert.equal(result.groups.length, 40);
    assert.equal(result.groups[0].name, longName);
    assert.equal(result.groups[0].description, longDescription);
    assert.deepEqual(result.ungrouped, []);
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
    assert.equal(options.maxTokens, undefined);
  });

  it("collects model output beyond the former character limit", async () => {
    const longDescription = `输出_${"长".repeat(9_000)}`;
    const llm = {
      async *stream() {
        const output = JSON.stringify({ name: "长输出", description: longDescription });
        yield { type: "text-delta", index: 0, text: output };
        yield { type: "finish", reason: { kind: "stop" } };
      },
    };
    const result = await generateGroupSuggestion(llm, {
      currentSelection: () => ({ provider: "deepseek", model: "chat" }),
    }, { tools: [tools[0]], otherGroupNames: [] });
    assert.equal(result.description, longDescription);
  });

  it("generates auto-groups for a subset of selected tools only", async () => {
    let promptText = "";
    const selectedSubset = tools.slice(0, 2); // web_search, web_fetch
    const llm = {
      async *stream(value) {
        promptText = value.messages?.[0]?.content?.[0]?.text ?? "";
        yield { type: "text-delta", index: 0, text: '{"groups":[{"name":"搜索工具","description":"网页搜索。","tools":["web_search"]}],"ungrouped":["web_fetch"]}' };
        yield { type: "finish", reason: { kind: "stop" } };
      },
    };
    const result = await generateAutoGroups(llm, {
      currentSelection: () => ({ provider: "deepseek", model: "chat" }),
    }, { tools: selectedSubset, otherGroupNames: [] });
    assert.match(promptText, /web_search/);
    assert.match(promptText, /web_fetch/);
    assert.doesNotMatch(promptText, /"read"/);
    assert.deepEqual(result, {
      groups: [{ name: "搜索工具", description: "网页搜索。", tools: ["web_search"] }],
      ungrouped: ["web_fetch"],
    });
  });

  it("normalizes custom prompts without a length limit", () => {
    assert.equal(normalizeCustomPrompt(undefined), undefined);
    assert.equal(normalizeCustomPrompt(null), undefined);
    assert.equal(normalizeCustomPrompt(""), undefined);
    assert.equal(normalizeCustomPrompt("   "), undefined);
    assert.equal(normalizeCustomPrompt("  自定义提示词  "), "自定义提示词");
    assert.equal(normalizeCustomPrompt("a".repeat(100_000)), "a".repeat(100_000));
    assert.throws(() => normalizeCustomPrompt(123), /prompt must be a string/);
  });

  it("uses custom prompt in generateGroupSuggestion when provided", async () => {
    let promptText = "";
    const llm = {
      async *stream(value) {
        promptText = value.messages?.[0]?.content?.[0]?.text ?? "";
        yield { type: "text-delta", index: 0, text: '{"name":"定制名称","description":"按定制提示生成的描述。"}' };
        yield { type: "finish", reason: { kind: "stop" } };
      },
    };
    const customPrompt = `自定义提示词：${"为网络类工具生成名称和描述".repeat(4_000)}`;
    const result = await generateGroupSuggestion(llm, {
      currentSelection: () => ({ provider: "deepseek", model: "chat" }),
    }, { tools: tools.slice(0, 2), otherGroupNames: [], prompt: customPrompt });
    assert.ok(customPrompt.length > 32_000);
    assert.equal(promptText, customPrompt);
    assert.deepEqual(result, { name: "定制名称", description: "按定制提示生成的描述。" });
  });

  it("uses custom prompt in generateAutoGroups when provided", async () => {
    let promptText = "";
    const selectedSubset = tools.slice(0, 2);
    const llm = {
      async *stream(value) {
        promptText = value.messages?.[0]?.content?.[0]?.text ?? "";
        yield { type: "text-delta", index: 0, text: '{"groups":[{"name":"自定义组","description":"自定义说明。","tools":["web_search","web_fetch"]}],"ungrouped":[]}' };
        yield { type: "finish", reason: { kind: "stop" } };
      },
    };
    const customPrompt = "自定义提示词：请将所有网络工具归为自定义组";
    const result = await generateAutoGroups(llm, {
      currentSelection: () => ({ provider: "deepseek", model: "chat" }),
    }, { tools: selectedSubset, otherGroupNames: [], prompt: customPrompt });
    assert.equal(promptText, customPrompt);
    assert.equal(result.groups[0].name, "自定义组");
    assert.deepEqual(result.groups[0].tools, ["web_search", "web_fetch"]);
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

describe("generation model selection", () => {
  const catalog = {
    listProviders: () => [{ id: "magpie", name: "Magpie" }, { id: "deepseek", name: "DeepSeek" }],
    listModels: async (provider) => {
      if (provider === "magpie") return [{ id: "flash" }, { id: "pro" }];
      if (provider === "deepseek") return [{ id: "chat" }];
      throw new Error(`unknown provider ${provider}`);
    },
    resolveModelInfo: async (provider, model) => {
      if (provider !== "magpie") return { provider, id: model, name: model };
      return {
        provider,
        id: model,
        name: model,
        reasoning: {
          efforts: [{ id: "low" }, { id: "max" }],
          ...(model === "pro" ? {} : { defaultEffort: "low" }),
        },
      };
    },
  };
  const deploymentDefault = { currentSelection: () => ({ provider: "deepseek", model: "chat", reasoningEffort: "max" }) };

  it("follows the default model when nothing was chosen", async () => {
    const resolved = await resolveGenerationSelection(catalog, deploymentDefault, undefined);
    assert.deepEqual(resolved.selection, { provider: "deepseek", model: "chat", reasoningEffort: "max" });
    assert.equal(resolved.notice, undefined);
  });

  it("keeps the default model while overriding only its effort", async () => {
    const fastDefault = { currentSelection: () => ({ provider: "magpie", model: "flash", reasoningEffort: "max" }) };
    const resolved = await resolveGenerationSelection(catalog, fastDefault, { reasoningEffort: "low" });
    assert.deepEqual(resolved.selection, { provider: "magpie", model: "flash", reasoningEffort: "low" });
    assert.equal(resolved.notice, undefined);

    // The route is not pinned, so a level the route does not declare is still
    // replaced by that route's own default instead of failing the request.
    const replaced = await resolveGenerationSelection(catalog, fastDefault, { reasoningEffort: "nuclear" });
    assert.deepEqual(replaced.selection, { provider: "magpie", model: "flash", reasoningEffort: "low" });
    assert.match(replaced.notice, /不支持推理强度「nuclear」/);

    // Nothing to check the level against: forward it as chosen.
    const unchecked = await resolveGenerationSelection(undefined, fastDefault, { reasoningEffort: "low" });
    assert.deepEqual(unchecked.selection, { provider: "magpie", model: "flash", reasoningEffort: "low" });
    assert.equal(unchecked.notice, undefined);
  });

  it("uses an available chosen model with its own effort", async () => {
    const resolved = await resolveGenerationSelection(catalog, deploymentDefault, {
      provider: "magpie", model: "flash", reasoningEffort: "low",
    });
    assert.deepEqual(resolved.selection, { provider: "magpie", model: "flash", reasoningEffort: "low" });
    assert.equal(resolved.notice, undefined);
  });

  it("falls back to the default model when the chosen provider is gone", async () => {
    const resolved = await resolveGenerationSelection(catalog, deploymentDefault, {
      provider: "retired", model: "flash",
    });
    assert.deepEqual(resolved.selection, { provider: "deepseek", model: "chat", reasoningEffort: "max" });
    assert.match(resolved.notice, /retired\/flash/);
    assert.match(resolved.notice, /Provider 当前不可用/);
    assert.match(resolved.notice, /已回退到默认模型「deepseek\/chat」/);
  });

  it("falls back to the default model when the chosen model is gone", async () => {
    const resolved = await resolveGenerationSelection(catalog, deploymentDefault, {
      provider: "magpie", model: "removed",
    });
    assert.deepEqual(resolved.selection, { provider: "deepseek", model: "chat", reasoningEffort: "max" });
    assert.match(resolved.notice, /magpie\/removed.*已被删除或未配置/);
  });

  it("keeps the chosen model when its catalog cannot be read", async () => {
    const broken = {
      listProviders: () => [{ id: "magpie", name: "Magpie" }],
      listModels: async () => { throw new Error("provider unreachable"); },
    };
    const resolved = await resolveGenerationSelection(broken, deploymentDefault, { provider: "magpie", model: "flash" });
    assert.deepEqual(resolved.selection, { provider: "magpie", model: "flash" });
    assert.equal(resolved.notice, undefined);
  });

  it("replaces an effort the chosen model does not declare", async () => {
    const replaced = await resolveGenerationSelection(catalog, deploymentDefault, {
      provider: "magpie", model: "flash", reasoningEffort: "nuclear",
    });
    assert.deepEqual(replaced.selection, { provider: "magpie", model: "flash", reasoningEffort: "low" });
    assert.match(replaced.notice, /不支持推理强度「nuclear」/);
    assert.match(replaced.notice, /默认强度「low」/);

    // No default effort to fall back to: the effort is dropped, not forwarded.
    const dropped = await resolveGenerationSelection(catalog, deploymentDefault, {
      provider: "magpie", model: "pro", reasoningEffort: "nuclear",
    });
    assert.deepEqual(dropped.selection, { provider: "magpie", model: "pro" });
    assert.match(dropped.notice, /已改为不指定推理强度/);
  });

  it("drops an effort when the chosen model declares no reasoning support", async () => {
    const resolved = await resolveGenerationSelection(catalog, deploymentDefault, {
      provider: "deepseek", model: "chat", reasoningEffort: "low",
    });
    assert.deepEqual(resolved.selection, { provider: "deepseek", model: "chat" });
    assert.match(resolved.notice, /不支持推理强度「low」/);
  });

  it("uses the chosen model unchecked when the Host publishes no catalog", async () => {
    const resolved = await resolveGenerationSelection(undefined, deploymentDefault, {
      provider: "magpie", model: "flash", reasoningEffort: "low",
    });
    assert.deepEqual(resolved.selection, { provider: "magpie", model: "flash", reasoningEffort: "low" });
    assert.equal(resolved.notice, undefined);
  });

  it("runs a pre-resolved selection instead of the default model", async () => {
    let options;
    const llm = {
      async *stream(value) {
        options = value;
        yield { type: "text-delta", index: 0, text: '{"groups":[{"name":"快速","description":"说明。","tools":["web_search"]}],"ungrouped":[]}' };
        yield { type: "finish", reason: { kind: "stop" } };
      },
    };
    await generateAutoGroups(llm, deploymentDefault, {
      tools: [tools[0]],
      otherGroupNames: [],
      selection: { provider: "magpie", model: "flash", reasoningEffort: "low" },
    });
    assert.equal(options.provider, "magpie");
    assert.equal(options.model, "flash");
    assert.equal(options.reasoningEffort, "low");
  });
});
