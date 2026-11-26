import type { AgentSessionLike, SessionEventLike } from "./dsh.js";
import { DISCOVERY_TOOL_NAME, type ResolvedGroupView } from "./types.js";

/**
 * How the exposure fold reads one Session log.
 */
export interface ExposureHistoryOptions {
  /**
   * The preset's active on-demand groups.
   *
   * Supplying them lets the fold attribute member-tool calls to their group and
   * drop a name that no longer names a group. Without them only `tool_list`
   * opens are recovered, keyed by the requested name — the historical
   * behaviour, still used by callers that only need the opened names.
   */
  groups?: readonly ResolvedGroupView[];
  /**
   * Groups kept open after each completed compaction, in most-recently-used
   * order. Absent keeps every group the Session ever opened.
   *
   * Recency is scoped to the current compaction interval: at each compaction a
   * group survives only when it was opened, reopened or used since the previous
   * compaction. A group that merely stayed open through an interval is closed
   * at the next compaction, because the compacted history no longer carries
   * the call that justified it.
   */
  keepAfterCompaction?: number;
}

/**
 * Rebuild the on-demand groups opened in one Session.
 *
 * The tool call/result log is the durable source of truth, and a fork's
 * inherited prefix counts: the child continues the same transcript, whose
 * `tool_list` result already told the model those tools are available for the
 * rest of the session. Hiding them again would contradict the history the
 * model reads, so a fork starts from the groups its shared prefix opened.
 * Groups the parent opened after the fork point are not in the child's log and
 * stay closed, as does every group on a Session that never opened one.
 *
 * `keepAfterCompaction` narrows that set at every completed compaction: the
 * replacement summary may have shadowed the `tool_list` results that justified
 * older openings, so only groups touched since the previous compaction stay
 * open, capped at the configured count. The whole log is replayed in order,
 * which makes a live prune and the restore after a restart compute the same
 * answer.
 */
export function restoredExposureNames(
  session: AgentSessionLike | undefined,
  options: ExposureHistoryOptions = {},
): Set<string> {
  const fold = new ExposureFold(options);
  if (!session) return fold.names();
  for (let seq = 0; seq < session.seq; seq += 1) {
    const event = session.eventAt(seq);
    if (event !== undefined) fold.observe(event, seq);
  }
  return fold.names();
}

interface OpenedGroup {
  /** Lowercased name, so one group is never counted twice under two spellings. */
  readonly key: string;
  readonly name: string;
  /** Seq of the newest event that touched this group; also its recency rank. */
  activity: number;
}

/**
 * One pass over a Session log, tracking which groups are open and how recently
 * each one was touched.
 *
 * Recency is the event seq, so it needs no clock and replays identically. A
 * member-tool call counts as the stronger "used" signal; a group that was only
 * ever opened keeps its opening time, which is also what a re-open refreshes.
 */
class ExposureFold {
  private readonly opened = new Map<string, OpenedGroup>();
  /** Lowercased group name → canonical display name; absent without `groups`. */
  private readonly groupsByName?: Map<string, string>;
  /** Tool name → its group, so a call can refresh that group's recency. */
  private readonly groupOfTool?: Map<string, string>;
  private readonly limit?: number;
  /** Seq of the previous completed compaction; activities at or before it are stale. */
  private lastCompactionSeq = -1;
  /** Native `tool_list` calls awaiting their result: callId → requested group. */
  private readonly pendingOpens = new Map<string, string>();
  /** Native member-tool calls awaiting their result: callId → canonical group. */
  private readonly pendingUses = new Map<string, string>();

  constructor(options: ExposureHistoryOptions) {
    if (options.groups !== undefined) {
      const byName = new Map<string, string>();
      const byTool = new Map<string, string>();
      for (const group of options.groups) {
        byName.set(group.name.toLowerCase(), group.name);
        for (const tool of group.tools) byTool.set(tool, group.name);
      }
      this.groupsByName = byName;
      this.groupOfTool = byTool;
    }
    const limit = options.keepAfterCompaction;
    this.limit = typeof limit === "number" && Number.isSafeInteger(limit) && limit >= 0
      ? limit
      : undefined;
  }

  observe(event: SessionEventLike, seq: number): void {
    switch (event.type) {
      case "tool/call":
        this.observeCall(event.data);
        return;
      case "tool/result":
        this.observeResult(event.data, seq);
        return;
      case "tool/ptc-dispatch":
        this.observePtcDispatch(event.data, seq);
        return;
      case "compaction/end":
        this.observeCompaction(event.data, seq);
        return;
      default:
        return;
    }
  }

  names(): Set<string> {
    return new Set(
      [...this.opened.values()]
        .sort((left, right) => left.activity - right.activity)
        .map((entry) => entry.name),
    );
  }

  private observeCall(data: unknown): void {
    const record = asRecord(data);
    if (!record || typeof record.callId !== "string" || typeof record.name !== "string") return;
    if (record.name === DISCOVERY_TOOL_NAME) {
      const value = fieldFromArguments(record.arguments, "group");
      if (value !== undefined) this.pendingOpens.set(record.callId, value);
      return;
    }
    const group = this.groupOfTool?.get(record.name);
    if (group !== undefined) this.pendingUses.set(record.callId, group);
  }

  private observeResult(data: unknown, seq: number): void {
    const settled = settledCall(asRecord(asRecord(data)?.message));
    if (settled === undefined) return;
    const opened = this.pendingOpens.get(settled.callId);
    if (opened !== undefined) {
      this.pendingOpens.delete(settled.callId);
      if (!settled.isError) this.touch(opened, seq);
      return;
    }
    const used = this.pendingUses.get(settled.callId);
    if (used === undefined) return;
    this.pendingUses.delete(settled.callId);
    if (!settled.isError) this.record(used, seq);
  }

  private observePtcDispatch(data: unknown, seq: number): void {
    const record = asRecord(data);
    if (!record || record.isError === true || typeof record.name !== "string") return;
    if (record.name === DISCOVERY_TOOL_NAME) {
      const value = fieldFromArguments(record.arguments, "group");
      if (value !== undefined) this.touch(value, seq);
      return;
    }
    const group = this.groupOfTool?.get(record.name);
    if (group !== undefined) this.record(group, seq);
  }

  /**
   * Apply the keep limit once per completed compaction.
   *
   * A failed attempt (`error` on `compaction/end`) leaves the transcript alone,
   * so it must not close anything and must not move the interval boundary. On a
   * completed compaction, only groups touched since the previous one are
   * candidates: a group that stayed open without being used or reopened during
   * the interval loses its justification in the compacted transcript and is
   * closed. Groups opened after this cut are not affected because they are not
   * in the map yet.
   */
  private observeCompaction(data: unknown, seq: number): void {
    const record = asRecord(data);
    if (!record || record.error !== undefined) return;
    if (this.limit === undefined) return;
    const prior = this.lastCompactionSeq;
    const candidates = [...this.opened.values()]
      .filter((entry) => entry.activity > prior)
      .sort((left, right) => right.activity - left.activity);
    const keep = new Set(candidates.slice(0, this.limit).map((entry) => entry.key));
    for (const entry of [...this.opened.values()]) {
      if (!keep.has(entry.key)) this.opened.delete(entry.key);
    }
    this.lastCompactionSeq = seq;
  }

  /** Record a group by the name a `tool_list` call requested. */
  private touch(requested: string, seq: number): void {
    const name = this.resolve(requested);
    if (name !== undefined) this.record(name, seq);
  }

  private resolve(requested: string): string | undefined {
    const trimmed = requested.trim();
    if (!trimmed) return undefined;
    if (this.groupsByName === undefined) return trimmed;
    return this.groupsByName.get(trimmed.toLowerCase());
  }

  private record(name: string, seq: number): void {
    const key = name.toLowerCase();
    // Re-inserting moves the entry to the end, keeping insertion order equal to
    // recency without a second sort on every touch.
    this.opened.delete(key);
    this.opened.set(key, { key, name, activity: seq });
  }
}

/**
 * The call identity and error flag of one `tool/result` message.
 *
 * DSH stores its own tool message — `toolCallId` and `isError` on the message,
 * text/image blocks in `content` — while a provider-shaped message carries an
 * Anthropic-style `tool-result` block inside `content`. Read both, so restore
 * never depends on which one the Host wrote.
 */
function settledCall(message: Record<string, unknown> | undefined): { callId: string; isError: boolean } | undefined {
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

function fieldFromArguments(value: unknown, field: string): string | undefined {
  let args = value;
  if (typeof args === "string") {
    try {
      args = JSON.parse(args);
    } catch {
      return undefined;
    }
  }
  const raw = asRecord(args)?.[field];
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed || undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}
