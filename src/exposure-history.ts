import type { AgentSessionLike, SessionEventLike } from "./dsh.js";
import { DISCOVERY_TOOL_NAME } from "./types.js";

/**
 * Rebuild the on-demand groups successfully opened in one Session.
 *
 * The tool call/result log is the durable source of truth, and a fork's
 * inherited prefix counts: the child continues the same transcript, whose
 * `tool_list` result already told the model those tools are available for the
 * rest of the session. Hiding them again would contradict the history the
 * model reads, so a fork starts from the groups its shared prefix opened.
 * Groups the parent opened after the fork point are not in the child's log and
 * stay closed, as does every group on a Session that never opened one.
 */
export function restoredExposureNames(
  session: AgentSessionLike | undefined,
): Set<string> {
  const restored = new Set<string>();
  if (!session) return restored;

  const pending = new Map<string, string>();
  for (let seq = 0; seq < session.seq; seq += 1) {
    const event = session.eventAt(seq);
    if (!event) continue;
    if (event.type === "tool/call") {
      rememberNativeCall(event, pending);
      continue;
    }
    if (event.type === "tool/result") {
      settleNativeCall(event, pending, restored);
      continue;
    }
    if (event.type === "tool/ptc-dispatch") {
      restorePtcDispatch(event, restored);
    }
  }
  return restored;
}

function rememberNativeCall(
  event: SessionEventLike,
  pending: Map<string, string>,
): void {
  const data = asRecord(event.data);
  if (data?.name !== DISCOVERY_TOOL_NAME || typeof data.callId !== "string") return;
  const group = groupFromArguments(data.arguments);
  if (group !== undefined) pending.set(data.callId, group);
}

function settleNativeCall(
  event: SessionEventLike,
  pending: Map<string, string>,
  restored: Set<string>,
): void {
  const settled = settledCall(asRecord(asRecord(event.data)?.message));
  if (settled === undefined) return;
  const group = pending.get(settled.callId);
  if (group === undefined) return;
  pending.delete(settled.callId);
  if (!settled.isError) restored.add(group);
}

/**
 * The call identity and error flag of one `tool/result` message.
 *
 * DSH stores its own tool message — `toolCallId` and `isError` on the message,
 * text/image blocks in `content` — while a provider-shaped message carries an
 * Anthropic-style `tool-result` block inside `content`. Read both, so restore
 * never depends on which one the Host wrote.
 */
function settledCall(
  message: Record<string, unknown> | undefined,
): { callId: string; isError: boolean } | undefined {
  if (!message) return undefined;
  const source = asRecord(message.source);
  const direct = nonEmpty(message.toolCallId) ?? nonEmpty(source?.callId);
  if (direct !== undefined) return { callId: direct, isError: message.isError === true };
  const content = Array.isArray(message.content) ? message.content : [];
  const block = content.map(asRecord).find((item) => item?.type === "tool-result");
  const blockId = nonEmpty(block?.toolCallId);
  if (blockId === undefined) return undefined;
  return { callId: blockId, isError: block?.isError === true };
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function restorePtcDispatch(
  event: SessionEventLike,
  restored: Set<string>,
): void {
  const data = asRecord(event.data);
  if (data?.name !== DISCOVERY_TOOL_NAME || data.isError === true) return;
  const group = groupFromArguments(data.arguments);
  if (group !== undefined) restored.add(group);
}

function groupFromArguments(value: unknown): string | undefined {
  let args: unknown = value;
  if (typeof args === "string") {
    try {
      args = JSON.parse(args) as unknown;
    } catch {
      return undefined;
    }
  }
  const group = asRecord(args)?.group;
  if (typeof group !== "string") return undefined;
  const trimmed = group.trim();
  return trimmed || undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}
