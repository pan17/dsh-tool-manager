/**
 * MCP-style on-demand tool loading.
 *
 * The model sees a group catalog instead of every tool: each group lists a name
 * and a description, and `tool_find({ group })` returns the full parameter
 * schema of every member. No keyword search: the catalog's group names and
 * descriptions are what the model selects from, and a keyword pass would only
 * add a second, slower path to the same tools.
 */
import { createHash, randomUUID } from "node:crypto";
import { isEnterDecision } from "./catalog.js";
import type { AgentLike, ToolSchemaLike } from "./dsh.js";
import { MCP_FIND_TOOL_NAME, type ToolSchemaView } from "./types.js";

export const MCP_NOTICE_SOURCE_KIND = "tool-manager-mcp-notice";

export interface McpGroupLookupResult {
  /** Group name, echoed from the catalog. */
  group: string;
  description?: string;
  tools: ToolSchemaView[];
  total: number;
  hint: string;
}

/** Project the members of one group into their model-facing schemas. */
export function groupLookup(
  group: { name: string; description?: string },
  members: readonly ToolSchemaLike[],
): McpGroupLookupResult {
  const tools = members.map((member) => ({
    name: member.name,
    description: member.description,
    parameters: member.parameters,
  }));
  return {
    group: group.name,
    ...(group.description ? { description: group.description } : {}),
    tools,
    total: tools.length,
    hint: `call any member of ${JSON.stringify(group.name)} by its own name with the parameters above`,
  };
}

export interface McpNoticeState {
  mode: "mcp" | "groups";
  /**
   * On-demand groups whose members are not declared individually.
   *
   * Name and description only: a member count would be rendered into the notice
   * and therefore republish it whenever a tool appears or disappears inside the
   * group, which is exactly the churn this notice exists to avoid. Membership is
   * `tool_find`'s answer, not the notice's.
   */
  groups?: Array<{ name: string; description?: string }>;
}

export interface McpNoticeSource extends McpNoticeState {
  kind: typeof MCP_NOTICE_SOURCE_KIND;
  /** DSH's `notice` context form; it requires the one-line `summary` beside it. */
  form: "notice";
  /** One-line account the chat client shows on the collapsed row. */
  summary: string;
  update?: true;
}

export interface McpNoticeMessage {
  id: string;
  role: "user";
  content: Array<{ type: "text"; text: string }>;
  source: McpNoticeSource;
}

export interface McpNoticeHistory {
  published: boolean;
  visibleDigest?: string;
}

/** Render the one persistent notice that tells the model how tools load now. */
export function renderMcpNoticeText(state: McpNoticeState, update: boolean): string {
  if (state.mode === "groups") {
    // Neutral on purpose: a groups-mode preset may have no group at all, and then
    // both the catalog and tool_list are absent, so promising either is a lie.
    const lines = [
      "<system-reminder>",
      "Tool loading switched back to on-demand groups for this session.",
      "Ignore every earlier tool_find instruction; on-demand tools follow the group rules instead.",
    ];
    if (update) lines.push("This notice replaces every earlier tool-loading notice in this session.");
    lines.push("</system-reminder>");
    return lines.join("\n");
  }
  const lines: string[] = [
    "<system-reminder>",
    "On-demand tools are grouped in this session: a group is listed by name and description, and its tools are not declared individually.",
  ];
  lines.push("", "<available_tool_groups>");
  for (const group of state.groups ?? []) {
    lines.push(group.description ? `- ${group.name}: ${group.description}` : `- ${group.name}`);
  }
  lines.push("</available_tool_groups>", "");
  lines.push(`Call ${MCP_FIND_TOOL_NAME}({ group: "<name>" }) to read that group's tools; every one of them is callable by its own name, and reading a schema changes nothing.`);
  if (update) lines.push("This notice replaces every earlier tool-loading notice in this session.");
  lines.push("</system-reminder>");
  return lines.join("\n");
}

/**
 * One-line account for the notice's collapsed row.
 *
 * DSH requires a `notice` source to carry `summary`; without it the chat client
 * has nothing to show on the row and falls back to printing the raw source,
 * which repeated every group name and description in the transcript.
 */
function noticeSummary(state: McpNoticeState): string {
  if (state.mode === "groups") return "Tool loading switched back to the group catalog";
  const count = state.groups?.length ?? 0;
  if (count > 0) return `${count} on-demand tool group${count === 1 ? "" : "s"}; call tool_find to read one`;
  return "No on-demand groups; every tool is declared in full";
}

/**
 * Digest of exactly what {@link renderMcpNoticeText} prints.
 *
 * Only the mode and the group list reach the text, so only those may change the
 * digest. Including the always-on tool names made the notice republish whenever
 * the baseline grew — a plugin install or a job registration was enough — while
 * the rendered text stayed identical. The group catalog has always hashed just
 * its rendered entries, and this is the same rule.
 */
export function digestMcpNotice(state: McpNoticeState): string {
  return createHash("sha256")
    .update(JSON.stringify([state.mode, state.groups ?? []]))
    .digest("hex");
}

export function renderMcpNoticeMessage(state: McpNoticeState, update: boolean): McpNoticeMessage {
  const message: McpNoticeMessage = {
    id: randomUUID(),
    role: "user",
    content: [{ type: "text", text: renderMcpNoticeText(state, update) }],
    source: {
      kind: MCP_NOTICE_SOURCE_KIND,
      form: "notice",
      mode: state.mode,
      // Stored for the same reason the catalog stores its entries: the digest is
      // recomputed from the rendered data instead of being trusted blindly.
      ...(state.groups === undefined ? {} : { groups: state.groups.map((group) => ({ ...group })) }),
      summary: noticeSummary(state),
      ...(update ? { update: true as const } : {}),
    },
  };
  Object.freeze(message.content[0]);
  Object.freeze(message.content);
  Object.freeze(message.source);
  return Object.freeze(message);
}

export function readMcpNotice(source: unknown): McpNoticeState | undefined {
  if (source === null || typeof source !== "object") return undefined;
  const record = source as { kind?: unknown; mode?: unknown };
  if (record.kind !== MCP_NOTICE_SOURCE_KIND) return undefined;
  if (record.mode !== "mcp" && record.mode !== "groups") return undefined;
  const raw = record as { groups?: unknown };
  const groups: Array<{ name: string; description?: string }> = [];
  for (const entry of Array.isArray(raw.groups) ? raw.groups : []) {
    const group = asRecord(entry);
    if (typeof group?.name !== "string") return undefined;
    groups.push({
      name: group.name,
      ...(typeof group.description === "string" && group.description ? { description: group.description } : {}),
    });
  }
  return {
    mode: record.mode,
    ...(groups.length === 0 ? {} : { groups }),
  };
}

/** Find the notice already published in this Session, if any. */
export function mcpNoticeHistory(agent: AgentLike): McpNoticeHistory {
  const session = agent.session;
  if (!session) return { published: false };
  const visible = new Set(session.surface?.nodes ?? []);
  let published = false;
  for (let index = session.seq - 1; index >= 0; index -= 1) {
    const event = session.eventAt(index);
    if (event === undefined) continue;
    if (event.type !== "user/message") continue;
    const data = asRecord(event.data);
    const state = readMcpNotice(data?.source);
    if (state === undefined) continue;
    published = true;
    if (visible.has(event.seq)) return { visibleDigest: digestMcpNotice(state), published };
  }
  return { published };
}

/**
 * Append, replace or drop the notice for this step.
 *
 * Mirrors the group catalog: the visible digest decides whether the message is
 * already in the model's history, and a mode change rewrites it in place.
 */
export function applyMcpNoticeDecision<T>(
  decision: T,
  state: McpNoticeState,
  history: McpNoticeHistory,
): T {
  if (!isEnterDecision(decision)) return decision;
  const messages = decision.messages as unknown[];
  const digest = digestMcpNotice(state);
  const existing = mcpNoticeMessage(messages);
  if (history.visibleDigest === digest) {
    return existing === undefined
      ? decision
      : { ...decision, messages: messages.filter((message) => message !== existing.message) } as T;
  }
  if (existing !== undefined && digestMcpNotice(existing.state) === digest) return decision;
  // MCP mode announces the group catalog and nothing else: no activation step
  // exists, so there is never a stale "open this group" notice to retire and
  // nothing to say once the last group is gone.
  const silent = state.mode === "groups"
    ? !history.published
    : (state.groups?.length ?? 0) === 0;
  if (silent) {
    return existing === undefined
      ? decision
      : { ...decision, messages: messages.filter((message) => message !== existing.message) } as T;
  }
  const notice = renderMcpNoticeMessage(state, history.published);
  return {
    ...decision,
    messages: existing === undefined
      ? [...messages, notice]
      : messages.map((message) => message === existing.message ? notice : message),
  } as T;
}

function mcpNoticeMessage(messages: readonly unknown[]): { message: unknown; state: McpNoticeState } | undefined {
  for (const message of messages) {
    const record = asRecord(message);
    if (!record) continue;
    const state = readMcpNotice(record.source);
    if (state === undefined) continue;
    return { message, state };
  }
  return undefined;
}

export interface McpToolBridge {
  /** Read every member of one on-demand group. */
  find(agent: AgentLike | undefined, args: unknown): McpGroupLookupResult;
}

/** The discovery tool: read one group's members and their full schemas. */
export function createMcpToolDefinitions(bridge: McpToolBridge): unknown[] {
  return [
    {
      name: MCP_FIND_TOOL_NAME,
      description:
        "Load the session's on-demand tools. Returns each match's description and full JSON parameter schema; the returned tools are directly callable by name from your next step.",
      parameters: {
        type: "object",
        properties: {
          group: {
            type: "string",
            description: "Exact group name from the catalog; returns every member's schema at once.",
          },
        },
        required: ["group"],
        additionalProperties: false,
      },
      output: {
        schema: { type: "object", additionalProperties: true },
        render: (_args: unknown, value: unknown) => [
          { type: "text", text: JSON.stringify(value, null, 2) },
        ],
      },
      execute: async (args: unknown, exec?: { agent?: AgentLike }) => bridge.find(exec?.agent, args),
    },
  ];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}
