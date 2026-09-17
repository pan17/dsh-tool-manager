import type { AgentSessionLike, SessionEventLike } from "./dsh.js";
import { DISCOVERY_TOOL_NAME } from "./types.js";

/**
 * Rebuild the on-demand groups successfully opened in one Session.
 *
 * The tool call/result log is the durable source of truth. This intentionally
 * excludes a fork's inherited prefix so temporary capability choices do not
 * leak from the parent Session into a new child Session.
 */
export function restoredExposureNames(
  session: AgentSessionLike | undefined,
): Set<string> {
  const restored = new Set<string>();
  if (!session) return restored;

  const pending = new Map<string, string>();
  const start = validBoundary(session.inheritedEventCount, session.seq);
  for (let seq = start; seq < session.seq; seq += 1) {
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
  const data = asRecord(event.data);
  const message = asRecord(data?.message);
  const content = Array.isArray(message?.content) ? message.content : [];
  const result = content.map(asRecord).find((block) => block?.type === "tool-result");
  const callId = result?.toolCallId;
  if (typeof callId !== "string") return;
  const group = pending.get(callId);
  if (group === undefined) return;
  pending.delete(callId);
  if (result?.isError !== true) restored.add(group);
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

function validBoundary(value: unknown, end: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return 0;
  return Math.min(value, end);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}
