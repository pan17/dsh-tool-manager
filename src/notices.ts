/**
 * User-facing notices.
 *
 * A registry reload is invisible to the transcript when the tool-manager
 * re-attaches the Session, but when it cannot, the *person* has to know: the
 * Session silently lost its preset tools and no amount of model-side wording
 * helps. These notices are collected on the Host and rendered as a banner in
 * the Web UI, so the reader learns about it where they are actually looking.
 */
export interface UserNotice {
  id: string;
  /** Epoch milliseconds, for ordering and display. */
  at: number;
  /**
   * Which stage this notice describes: `reloading` is the transient "a registry
   * reload just happened, a repair is coming", `failed` is the durable "the
   * repair could not work, restart DSH". They share a Session and preset, so the
   * stage is part of the identity rather than a replacement.
   */
  kind: "reloading" | "failed";
  /** The Session that lost tools, when the notice is about one. */
  sessionId?: string;
  /** The preset it was running. */
  presetId?: string;
  message: string;
}

export interface UserNoticeInput {
  kind: UserNotice["kind"];
  sessionId?: string;
  presetId?: string;
  message: string;
}

/** How many unacknowledged notices to keep before dropping the oldest. */
const LIMIT = 20;

/**
 * The one notice box per Host, kept on the global object.
 *
 * This plugin declares `agentPresets` in `inject`, so DSH restarts it whenever
 * the registry is replaced — the very moment a notice matters. An instance-local
 * box would drop the banner exactly when the reader needs to see it.
 */
const BOX_KEY = Symbol.for("dsh-tool-manager.notice-box");

function sharedBox(): UserNotices {
  const holder = globalThis as unknown as Record<symbol, UserNotices | undefined>;
  holder[BOX_KEY] ??= new UserNotices();
  return holder[BOX_KEY];
}

/** In-memory notice box: one row per affected Session and preset. */
export class UserNotices {
  private readonly items: UserNotice[] = [];
  private sequence = 0;

  /**
   * Record one notice, collapsing repeats of the same Session and preset.
   *
   * The runtime can attempt a repair more than once (each step retries), and a
   * banner that multiplies on every retry is noise; the message is the same.
   * @param input - what happened and to whom.
   * @returns the stored notice, or `undefined` when it was already present.
   */
  add(input: UserNoticeInput): UserNotice | undefined {
    const duplicate = this.items.find((item) => (
      item.kind === input.kind
      && item.sessionId === input.sessionId
      && item.presetId === input.presetId
    ));
    if (duplicate !== undefined) return undefined;
    this.sequence += 1;
    const notice: UserNotice = {
      id: `notice-${this.sequence}`,
      at: Date.now(),
      kind: input.kind,
      message: input.message,
      ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
      ...(input.presetId === undefined ? {} : { presetId: input.presetId }),
    };
    this.items.push(notice);
    if (this.items.length > LIMIT) this.items.splice(0, this.items.length - LIMIT);
    return notice;
  }

  /**
   * Drop a notice once its cause is gone.
   *
   * A `reloading` notice promises a repair, and a `failed` one claims the repair
   * cannot work; when the repair does succeed both are stale, so a late success
   * withdraws the whole story rather than leaving a "restart DSH" banner behind.
   * @param sessionId - the Session that was repaired.
   * @param presetId - the preset it was re-attached to.
   */
  settle(sessionId: string | undefined, presetId: string | undefined): void {
    for (let index = this.items.length - 1; index >= 0; index -= 1) {
      const item = this.items[index]!;
      if (item.sessionId !== sessionId || item.presetId !== presetId) continue;
      this.items.splice(index, 1);
    }
  }

  /** Current notices, oldest first. */
  list(): readonly UserNotice[] {
    return this.items;
  }

  /**
   * Dismiss notices the reader has seen.
   * @param ids - identifiers to drop; unknown ids are ignored.
   * @returns how many were dropped.
   */
  ack(ids: readonly string[]): number {
    const wanted = new Set(ids);
    let dropped = 0;
    for (let index = this.items.length - 1; index >= 0; index -= 1) {
      if (!wanted.has(this.items[index]!.id)) continue;
      this.items.splice(index, 1);
      dropped += 1;
    }
    return dropped;
  }

  /** Whether anything is waiting to be read. */
  get pending(): boolean {
    return this.items.length > 0;
  }
}

/**
 * The Host-wide notice box.
 *
 * A plugin restart must not lose an unread notice, and the reader dismisses
 * through whichever instance is live at that moment.
 */
export function userNotices(): UserNotices {
  return sharedBox();
}
