import type {
  AgentDefaultModelLike,
  LlmRuntimeLike,
  ModelSelectionLike,
  StreamChunkLike,
  ToolSchemaLike,
} from "./dsh.js";

export const MAX_SUGGESTION_TOOLS = 64;
export const MAX_CUSTOM_PROMPT_LENGTH = 32_000;
export const MAX_AUTO_GROUP_TOOLS = 120;
export const MAX_AUTO_GROUPS = 32;
export const MAX_GROUP_NAME_LENGTH = 40;
export const MAX_GROUP_DESCRIPTION_LENGTH = 240;
const MAX_TOOL_NAME_LENGTH = 160;
const MAX_TOOL_DESCRIPTION_LENGTH = 600;
const MAX_MODEL_OUTPUT_LENGTH = 8_192;
export const DEFAULT_SUGGESTION_TIMEOUT_MS = 60_000;
export const DEFAULT_AUTO_GROUP_TIMEOUT_MS = 120_000;
export const MIN_GENERATION_TIMEOUT_MS = 5_000;
export const MAX_GENERATION_TIMEOUT_MS = 600_000;

export interface GroupSuggestion {
  name: string;
  description: string;
}

export interface GroupSuggestionRequest {
  tools: ToolSchemaLike[];
  otherGroupNames: string[];
  prompt?: string;
}

export interface AutoGroupSuggestion extends GroupSuggestion {
  tools: string[];
}

export interface AutoGroupResult {
  groups: AutoGroupSuggestion[];
  ungrouped: string[];
}

export interface AutoGroupRequest {
  tools: ToolSchemaLike[];
  otherGroupNames: string[];
  prompt?: string;
}

export async function generateGroupSuggestion(
  llm: LlmRuntimeLike,
  defaultModel: AgentDefaultModelLike,
  request: GroupSuggestionRequest,
  timeoutMs = DEFAULT_SUGGESTION_TIMEOUT_MS,
): Promise<GroupSuggestion> {
  if (request.tools.length === 0) throw new Error("请至少选择一个工具后再生成");
  if (request.tools.length > MAX_SUGGESTION_TOOLS) {
    throw new Error(`一次最多根据 ${MAX_SUGGESTION_TOOLS} 个工具生成分组`);
  }

  const customPrompt = normalizeCustomPrompt(request.prompt);
  const prompt = customPrompt ?? buildSuggestionPrompt(request);
  const selection = validateSelection(defaultModel.currentSelection());
  const effectiveTimeoutMs = validateGenerationTimeout(timeoutMs);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("tool-manager group suggestion timed out"), effectiveTimeoutMs);
  try {
    const text = await collectModelText(llm, selection, prompt, controller.signal);
    const suggestion = parseGroupSuggestion(text);
    const conflicts = new Set(request.otherGroupNames.map(normalizeComparableName));
    if (conflicts.has(normalizeComparableName(suggestion.name))) {
      throw new Error(`模型生成的名称“${suggestion.name}”与现有分组重复，请重试或手动修改`);
    }
    return suggestion;
  } catch (error) {
    throw generationError(error, controller.signal, "自动生成名称和描述", effectiveTimeoutMs);
  } finally {
    clearTimeout(timeout);
  }
}

export function selectSuggestionTools(
  schemas: ToolSchemaLike[],
  requestedNames: unknown,
  limit = MAX_SUGGESTION_TOOLS,
): ToolSchemaLike[] {
  if (!Array.isArray(requestedNames)) throw new Error("toolNames must be an array");
  const names = [...new Set(requestedNames.map((value) => {
    if (typeof value !== "string" || !value.trim()) throw new Error("toolNames must contain non-empty strings");
    return value.trim();
  }))];
  if (names.length === 0) throw new Error("请至少选择一个工具后再生成");
  if (names.length > limit) {
    throw new Error(`一次最多根据 ${limit} 个工具生成分组`);
  }
  const byName = new Map(schemas.map((schema) => [schema.name, schema]));
  const unknown = names.filter((name) => !byName.has(name));
  if (unknown.length > 0) throw new Error(`所选工具不存在或已变化：${unknown.join(", ")}`);
  return names.map((name) => byName.get(name) as ToolSchemaLike);
}

export function normalizeGroupNames(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("otherGroupNames must be an array");
  if (value.length > 256) throw new Error("现有分组名称过多");
  return [...new Set(value.map((item) => {
    if (typeof item !== "string") throw new Error("otherGroupNames must contain strings");
    return normalizeWhitespace(item).slice(0, MAX_GROUP_NAME_LENGTH);
  }).filter(Boolean))];
}

export function normalizeCustomPrompt(prompt: unknown): string | undefined {
  if (prompt === undefined || prompt === null) return undefined;
  if (typeof prompt !== "string") throw new Error("prompt must be a string");
  const trimmed = prompt.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > MAX_CUSTOM_PROMPT_LENGTH) {
    throw new Error(`提示词过长（超过 ${MAX_CUSTOM_PROMPT_LENGTH} 个字符）`);
  }
  return trimmed;
}

export async function generateAutoGroups(
  llm: LlmRuntimeLike,
  defaultModel: AgentDefaultModelLike,
  request: AutoGroupRequest,
  timeoutMs = DEFAULT_AUTO_GROUP_TIMEOUT_MS,
): Promise<AutoGroupResult> {
  if (request.tools.length === 0) throw new Error("当前没有可自动分组的工具");
  if (request.tools.length > MAX_AUTO_GROUP_TOOLS) {
    throw new Error(`自动分组一次最多处理 ${MAX_AUTO_GROUP_TOOLS} 个工具，请先手工缩小范围`);
  }
  const customPrompt = normalizeCustomPrompt(request.prompt);
  const prompt = customPrompt ?? buildAutoGroupPrompt(request);
  const selection = validateSelection(defaultModel.currentSelection());
  const effectiveTimeoutMs = validateGenerationTimeout(timeoutMs);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("tool-manager auto grouping timed out"), effectiveTimeoutMs);
  try {
    const text = await collectModelText(
      llm,
      selection,
      prompt,
      controller.signal,
      1_600,
    );
    return parseAutoGroupResult(text, request.tools.map((tool) => tool.name), request.otherGroupNames);
  } catch (error) {
    throw generationError(error, controller.signal, "自动分组", effectiveTimeoutMs);
  } finally {
    clearTimeout(timeout);
  }
}

export function buildSuggestionPrompt(request: GroupSuggestionRequest): string {
  const tools = request.tools.map((tool) => ({
    name: tool.name.slice(0, MAX_TOOL_NAME_LENGTH),
    description: normalizeWhitespace(tool.description).slice(0, MAX_TOOL_DESCRIPTION_LENGTH),
  }));
  const forbidden = request.otherGroupNames.length > 0 ? request.otherGroupNames : ["（无）"];
  return [
    "请根据以下已选择的工具，为一个按需工具组生成名称和描述。",
    "要求：",
    "1. 名称使用简洁自然的中文，概括共同用途，建议 2 到 10 个汉字。",
    "2. 描述使用一句简洁中文，说明该组适合完成什么任务，不要逐个罗列工具。",
    `3. 名称不得与这些其他分组重名：${forbidden.join("、")}。`,
    `4. 名称不超过 ${MAX_GROUP_NAME_LENGTH} 个字符，描述不超过 ${MAX_GROUP_DESCRIPTION_LENGTH} 个字符。`,
    "5. 只输出一个 JSON 对象，不要输出 Markdown、解释或额外字段。格式：{\"name\":\"...\",\"description\":\"...\"}",
    "已选择工具：",
    JSON.stringify(tools, null, 2),
  ].join("\n");
}

export function buildAutoGroupPrompt(request: AutoGroupRequest): string {
  const tools = request.tools.map((tool) => ({
    name: tool.name.slice(0, MAX_TOOL_NAME_LENGTH),
    description: normalizeWhitespace(tool.description).slice(0, MAX_TOOL_DESCRIPTION_LENGTH),
  }));
  const forbidden = request.otherGroupNames.length > 0 ? request.otherGroupNames : ["（无）"];
  return [
    "请把以下尚未分组的工具按共同能力和使用场景聚类成多个按需工具组，并为每组生成中文名称和描述。",
    "要求：",
    "1. 每个工具最多出现在一个组；tools 必须使用输入中的精确工具名。",
    "2. 不要为了覆盖全部工具而制造不合理分组；不适合归组的工具放入 ungrouped。",
    "3. 避免只有一个工具的碎片组，也避免含义模糊、规模过大的杂项组；组数由工具语义决定。",
    "4. 每组名称使用简洁自然的中文，建议 2 到 10 个汉字；描述用一句简洁中文概括用途。",
    `5. 新组名称互不重复，且不得与这些现有分组重名：${forbidden.join("、")}。`,
    `6. 最多生成 ${MAX_AUTO_GROUPS} 个组；名称不超过 ${MAX_GROUP_NAME_LENGTH} 个字符，描述不超过 ${MAX_GROUP_DESCRIPTION_LENGTH} 个字符。`,
    "7. 只输出一个 JSON 对象，不要输出 Markdown、解释或额外字段。",
    "格式：{\"groups\":[{\"name\":\"...\",\"description\":\"...\",\"tools\":[\"exact_name\"]}],\"ungrouped\":[\"exact_name\"]}",
    "候选工具：",
    JSON.stringify(tools, null, 2),
  ].join("\n");
}

export function parseAutoGroupResult(
  output: string,
  candidateNames: string[],
  otherGroupNames: string[],
): AutoGroupResult {
  const parsed = parseJsonRecord(output, "模型返回的自动分组结果");
  if (!Array.isArray(parsed.groups)) throw new Error("模型返回的自动分组结果缺少 groups 数组");
  if (parsed.groups.length > MAX_AUTO_GROUPS) throw new Error(`模型生成的分组超过 ${MAX_AUTO_GROUPS} 个`);
  const candidates = new Set(candidateNames);
  const forbidden = new Set(otherGroupNames.map(normalizeComparableName));
  const groupNames = new Set<string>();
  const assigned = new Set<string>();
  const groups: AutoGroupSuggestion[] = [];
  for (const raw of parsed.groups) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new Error("模型返回了格式无效的分组");
    const record = raw as Record<string, unknown>;
    const name = typeof record.name === "string" ? normalizeWhitespace(record.name) : "";
    const description = typeof record.description === "string" ? normalizeWhitespace(record.description) : "";
    if (!name || !description) throw new Error("模型返回了名称或描述为空的分组");
    if (name.length > MAX_GROUP_NAME_LENGTH) throw new Error(`分组名称“${name}”过长`);
    if (description.length > MAX_GROUP_DESCRIPTION_LENGTH) throw new Error(`分组“${name}”的描述过长`);
    const comparable = normalizeComparableName(name);
    if (forbidden.has(comparable)) throw new Error(`模型生成的名称“${name}”与现有分组重复`);
    if (groupNames.has(comparable)) throw new Error(`模型生成了重复的分组名称“${name}”`);
    groupNames.add(comparable);
    if (!Array.isArray(record.tools) || record.tools.length === 0) throw new Error(`分组“${name}”没有工具`);
    const names = record.tools.map((value) => {
      if (typeof value !== "string" || !value.trim()) throw new Error(`分组“${name}”包含无效工具名`);
      return value.trim();
    });
    if (new Set(names).size !== names.length) throw new Error(`分组“${name}”包含重复工具`);
    for (const toolName of names) {
      if (!candidates.has(toolName)) throw new Error(`模型返回了未知工具“${toolName}”`);
      if (assigned.has(toolName)) throw new Error(`工具“${toolName}”被分到多个组`);
      assigned.add(toolName);
    }
    groups.push({ name, description, tools: names });
  }
  if (groups.length === 0) throw new Error("模型没有生成任何有效分组，请手工分组或重试");
  const declaredUngrouped = parsed.ungrouped === undefined ? [] : parsed.ungrouped;
  if (!Array.isArray(declaredUngrouped)) throw new Error("模型返回的 ungrouped 不是数组");
  const ungrouped = declaredUngrouped.map((value) => {
    if (typeof value !== "string" || !value.trim()) throw new Error("模型返回了无效的未分组工具名");
    const name = value.trim();
    if (!candidates.has(name)) throw new Error(`模型返回了未知工具“${name}”`);
    if (assigned.has(name)) throw new Error(`工具“${name}”同时出现在分组和 ungrouped 中`);
    return name;
  });
  if (new Set(ungrouped).size !== ungrouped.length) throw new Error("ungrouped 中包含重复工具");
  const seenUngrouped = new Set(ungrouped);
  for (const name of candidateNames) {
    if (!assigned.has(name) && !seenUngrouped.has(name)) ungrouped.push(name);
  }
  return { groups, ungrouped };
}

export function parseGroupSuggestion(output: string): GroupSuggestion {
  const trimmed = output.trim();
  if (!trimmed) throw new Error("模型没有返回名称和描述");
  const record = parseJsonRecord(trimmed, "模型返回的分组建议");
  const name = typeof record.name === "string" ? normalizeWhitespace(record.name) : "";
  const description = typeof record.description === "string" ? normalizeWhitespace(record.description) : "";
  if (!name || !description) throw new Error("模型返回的名称或描述为空，请重试");
  if (name.length > MAX_GROUP_NAME_LENGTH) {
    throw new Error(`模型返回的名称超过 ${MAX_GROUP_NAME_LENGTH} 个字符，请重试`);
  }
  if (description.length > MAX_GROUP_DESCRIPTION_LENGTH) {
    throw new Error(`模型返回的描述超过 ${MAX_GROUP_DESCRIPTION_LENGTH} 个字符，请重试`);
  }
  return { name, description };
}

async function collectModelText(
  llm: LlmRuntimeLike,
  selection: ModelSelectionLike,
  prompt: string,
  signal: AbortSignal,
  maxTokens = 320,
): Promise<string> {
  const deltas = new Map<number, string>();
  const blocks = new Map<number, string>();
  let sawToolCall = false;
  let terminal: Extract<StreamChunkLike, { type: "finish" }> | undefined;
  const messageId = `tool-manager-suggestion-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  for await (const chunk of llm.stream({
    provider: selection.provider,
    model: selection.model,
    ...(selection.reasoningEffort ? { reasoningEffort: selection.reasoningEffort } : {}),
    messages: [{
      id: messageId,
      role: "user",
      content: [{ type: "text", text: prompt }],
      source: { kind: "plugin", plugin: "dsh-tool-manager" },
    }],
    system: "你是工具目录编辑助手。严格按用户要求只返回 JSON。",
    temperature: 0.2,
    maxTokens,
    signal,
  })) {
    if (chunk.type === "text-delta") {
      deltas.set(chunk.index, (deltas.get(chunk.index) ?? "") + chunk.text);
    } else if (chunk.type === "block-start" && chunk.blockType === "tool-call") {
      sawToolCall = true;
    } else if (chunk.type === "block-end") {
      if (chunk.block?.type === "tool-call") sawToolCall = true;
      if (chunk.block?.type === "text" && typeof chunk.block.text === "string") {
        blocks.set(chunk.index, chunk.block.text);
      }
    } else if (chunk.type === "finish") {
      terminal = chunk;
    }
    const size = [...deltas.values(), ...blocks.values()].reduce((sum, text) => sum + text.length, 0);
    if (size > MAX_MODEL_OUTPUT_LENGTH) throw new Error("模型返回内容过长，请重试");
  }
  if (sawToolCall) throw new Error("模型返回了工具调用而不是分组建议，请重试");
  if (!terminal) throw new Error("模型响应未正常结束，请重试");
  if (terminal.reason?.kind === "error" || terminal.reason?.kind === "aborted") {
    throw new Error(terminal.reason.failure?.message || "模型生成失败，请重试");
  }
  const source = blocks.size > 0 ? blocks : deltas;
  return [...source.entries()].sort(([a], [b]) => a - b).map(([, text]) => text).join("");
}

export function validateGenerationTimeout(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error("timeoutMs must be an integer number of milliseconds");
  }
  if (value < MIN_GENERATION_TIMEOUT_MS || value > MAX_GENERATION_TIMEOUT_MS) {
    throw new Error(
      `timeoutMs must be between ${MIN_GENERATION_TIMEOUT_MS} and ${MAX_GENERATION_TIMEOUT_MS} milliseconds`,
    );
  }
  return value;
}

function generationError(
  error: unknown,
  signal: AbortSignal,
  operation: string,
  timeoutMs: number,
): Error {
  if (signal.aborted) {
    return new Error(`${operation}等待模型响应超过 ${Math.round(timeoutMs / 1_000)} 秒，请重试或增加超时时间。`);
  }
  if (error instanceof Error && (error.name === "AbortError" || /operation was aborted/i.test(error.message))) {
    return new Error(`${operation}被模型服务中止，请重试。`);
  }
  return error instanceof Error ? error : new Error(String(error));
}

function validateSelection(selection: ModelSelectionLike | undefined): ModelSelectionLike {
  if (!selection || typeof selection.provider !== "string" || !selection.provider.trim()
    || typeof selection.model !== "string" || !selection.model.trim()) {
    throw new Error("当前没有配置默认模型，无法自动生成");
  }
  return selection;
}

function parseJsonRecord(output: string, label: string): Record<string, unknown> {
  const candidate = unwrapJson(output.trim());
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    throw new Error(`${label}不是有效 JSON，请重试`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label}格式无效`);
  }
  return parsed as Record<string, unknown>;
}

function unwrapJson(value: string): string {
  const fence = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fence ? (fence[1] ?? "").trim() : value;
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeComparableName(value: string): string {
  return normalizeWhitespace(value).toLocaleLowerCase();
}
