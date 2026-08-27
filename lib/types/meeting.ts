/**
 * One get-together, from initiation to close — and everything a person does
 * to it (spec §6.2, §3.2, §5.6, §5.7).
 */

import type {
  LatLng,
  LocalDate,
  LocalTimeOfDay,
  LocalWindow,
  TimeSlot,
} from "./primitives";
import type { MobilityMode } from "./profile";

/**
 * The stored lifecycle (database enum `MeetingStatus`).
 *
 * `conflicting` is **not** here, and that is deliberate: it is a property of
 * one viewer's whole schedule, not of the meeting, so it is derived at read
 * time and never written down (spec §5.6). It lives in `MeetingCardStatus`.
 *
 * `__tests__/types.test.ts` fails at type-check time if this drifts from the
 * generated Prisma enum.
 */
export type MeetingStatus =
  "weighing" | "awaiting" | "closed" | "stuck" | "cancelled";

/**
 * What the initiator pinned, if anything (spec §3, §5.3 — the all-blank case
 * is the default path, not a degraded one).
 *
 * The database holds this as two columns, `pinnedDate` and `pinnedTime`, and
 * hiding that seam is the reason `meetingFromRow` exists. Two variants rather
 * than a nullable time, so "a day, no time yet" cannot be silently read as
 * midnight.
 *
 * It stays local wall clock. A human typed it, and it becomes an instant only
 * where a zone is applied on purpose — see the time rule in `primitives.ts`.
 */
export type PinnedWhen =
  | { kind: "date"; date: LocalDate }
  | { kind: "date_and_time"; date: LocalDate; time: LocalTimeOfDay };

export type Meeting = {
  id: string;
  groupId: string;
  initiatorId: string;
  status: MeetingStatus;

  /** Rejection cycles spent. Default cap 3; beyond it the meeting is `stuck`. */
  cycleCount: number;

  pinnedWhen: PinnedWhen | null;
  pinnedVenue: string | null;

  /** Free text set at initiation; an input to the Context Resolver (spec §6.2). */
  occasion: string | null;

  /**
   * The current top option's time, denormalised so the feed can sort and the
   * cross-group conflict query can scan without joining (spec §5.7). A machine
   * wrote it, so it is an instant.
   */
  currentDatetime: Date | null;

  createdAt: Date;
  updatedAt: Date;
};

/**
 * Three response kinds, and they are three on purpose (spec §3.2): `approved`,
 * "I can't make it" and "this doesn't suit me" are different information, and
 * collapsing the last two is what the two-button split exists to prevent.
 *
 * The **amendment** — "I have no car tonight" — is deliberately absent. It is
 * not a response at all: it corrects the *input* rather than rejecting the
 * *output*, so it spends no cycle and is recorded as a
 * `ParticipantMeetingContext` row instead.
 *
 * `pending` is a real stored value: a row exists for every group member from
 * the moment the meeting is created.
 *
 * Type-check guarded against the generated Prisma enum, as above.
 */
export type ResponseStatus =
  "pending" | "approved" | "cant_make_it" | "doesnt_suit";

export type Response = {
  id: string;
  meetingId: string;
  userId: string;
  status: ResponseStatus;
  /** The rejection reason, in the person's own words. Feeds the next run. */
  reasonText: string | null;
  respondedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * A stretch of wall clock in which a mode is, or is not, available —
 * "no car between 18:00 and 21:00" (spec §6.2).
 *
 * `available: false` is the common case. The positive form exists so "I have
 * the car only until 19:00" does not have to be written inside out.
 */
export type MobilityWindow = {
  mode: MobilityMode;
  available: boolean;
  window: LocalWindow;
};

/**
 * The amendment: a sparse per-meeting correction (spec §3.2, §5.7).
 *
 * A row exists only when someone amends, and each amendment appends rather
 * than overwriting, so the timeline can say which one triggered which
 * re-weighing. Amendments outrank the recurring rules in the profile, which in
 * turn outrank the profile default (spec §5.7).
 */
export type ParticipantMeetingContext = {
  id: string;
  meetingId: string;
  userId: string;

  /** Where this person is starting from tonight, if not home. */
  origin: LatLng | null;
  originLabel: string | null;

  mobilityWindows: MobilityWindow[];
  note: string | null;
  createdAt: Date;
};

/**
 * "I know these two clash, stop telling me" — one viewer, one pair of
 * meetings (spec §5.7). Suppresses the `conflicting` label for that pair only.
 */
export type ConflictDismissal = {
  id: string;
  userId: string;
  meetingAId: string;
  meetingBId: string;
  createdAt: Date;
};

/**
 * What a meeting looks like on the feed (spec §5.6).
 *
 * A different type from `MeetingStatus`, for two reasons that are easy to
 * forget once the code is written: `waiting_on_you` depends on *who is
 * looking*, and `conflicting` is a property of that viewer's other meetings in
 * other groups. Neither is a fact about the meeting.
 *
 * Only `waiting_on_you` gets the brand colour. If everything is emphasised,
 * nothing is.
 */
export type MeetingCardStatus =
  | "waiting_on_you"
  | "waiting_on_others"
  | "reweighing"
  | "conflicting"
  | "stuck"
  | "closed";

/**
 * Everything the derivation needs, stated once so the UI and the query agree.
 *
 * The function itself is not here — it belongs with whoever writes the feed
 * query. This type is the contract between them.
 */
export type MeetingCardStatusInput = {
  meeting: Meeting;
  /** Every member's row, including the `pending` ones. Gives the N in "waiting on N others". */
  responses: Response[];
  /** The person looking. This is what makes the result per-viewer. */
  viewerId: string;
  /**
   * Arrives **already computed**, from §5.7's cross-group query over the
   * viewer's whole schedule — Track B's work, using F4's
   * `[status, currentDatetime]` index, with `ConflictDismissal` applied.
   *
   * A boolean and not a query on purpose: the UI cannot derive this, and a
   * signature that suggested otherwise would invite it to try.
   */
  hasConflict: boolean;
};

/** Convenience for the feed: a meeting with its viewer-specific label. */
export type MeetingCard = {
  meeting: Meeting;
  status: MeetingCardStatus;
  /** Populated when `status` is `waiting_on_others`. */
  waitingOn: number;
  /** The proposal currently on the table, as an instant, when there is one. */
  proposedSlot: TimeSlot | null;
};
