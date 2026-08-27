/**
 * The candidate funnel and the matching run (spec §5.4, §4.1, §6.2).
 *
 * The one idea that shapes every type in this file: **every distance question
 * is really a (venue, time) question** (spec §5.4). A mobility window and a
 * venue's opening hours both depend on when the meeting is, so the funnel
 * scores `candidates × participants × time slots`. Tolerance is therefore per
 * slot, never a scalar, and `Burden` carries the whole triple.
 *
 * That is the single most expensive thing to retrofit, which is why it is here
 * while every value is still a constant.
 */

import type { PreferenceProfile } from "./profile";
import type { ParticipantMeetingContext } from "./meeting";
import type { Kilometres, LatLng, LocalWindow, TimeSlot } from "./primitives";

/**
 * A venue as the funnel sees it — a Google Places result, narrowed to what we
 * asked for in the field mask.
 *
 * `rating` and `openingHours` are optional because **it is not yet settled
 * whether we fetch them at all** (spec §5.4, §13.6, §13.7): both are
 * Enterprise-tier fields, and the tier decides what a request costs. Code that
 * treats either as guaranteed is code that will need changing when that
 * decision lands.
 */
export type Candidate = {
  /** Places id. The dedupe key and the cache key. */
  placeId: string;
  name: string;
  address: string | null;
  location: LatLng;
  neighbourhood: string | null;
  /** Undecided — ranking signal, or droppable? (spec §13.6) */
  rating?: number;
  /** Undecided — hard constraint, or a preference the agent weighs? (spec §13.7) */
  openingHours?: LocalWindow[];
};

/**
 * One participant, assembled for one run: who they are, what they always want,
 * and what they said about tonight.
 */
export type Participant = {
  userId: string;
  name: string;
  profile: PreferenceProfile;
  /**
   * The latest amendment, if this person made one. Outranks the profile's
   * recurring rules, which outrank the profile default (spec §5.7).
   */
  context: ParticipantMeetingContext | null;
  /**
   * Where the burden is measured from, after that precedence is applied:
   * the amendment's origin if there is one, otherwise home.
   */
  origin: LatLng | null;
  /** Busy blocks from Google Calendar free/busy. Instants — a machine wrote them. */
  busy: TimeSlot[];
};

/**
 * How far one venue is from one person, at one time.
 *
 *   burden = straight_line_distance × detour_factor / tolerance_km
 *
 * Dimensionless: `1.0` is exactly the limit that person stated, `1.4` is half
 * again as far as they are comfortable with (spec §5.4).
 *
 * ⚠️ This is a geographic estimate, not a routed journey. The system does not
 * compute real driving or travel time, and no UI string or report claim may
 * say that it does (spec §5.4).
 */
export type Burden = {
  candidatePlaceId: string;
  participantId: string;
  slot: TimeSlot;
  /** The value above. Above the gate `T`, the candidate is dropped entirely. */
  value: number;
};

/** One venue's row in the shortlist, with the numbers that put it there. */
export type ShortlistEntry = {
  candidate: Candidate;
  /** One per participant per viable slot. */
  burdens: Burden[];
  /** Slots at which this venue is usable for the whole group. */
  viableSlots: TimeSlot[];
};

/**
 * One query centre. The union of these is the search area (spec §5.4): one
 * query per participant neighbourhood, deduplicated — never a single wide
 * bounding query, which under a result cap trades near venues for far ones.
 */
export type SearchRegion = {
  id: string;
  centre: LatLng;
  radiusKm: Kilometres;
};

/**
 * How much further two regions really are than the straight line between them
 * — a motorway or a river with no crossing. `1.0` is as the crow flies, and
 * the value is never below it.
 */
export type DetourFactor = {
  fromRegionId: string;
  toRegionId: string;
  /** `>= 1.0`. Clamped on the way in; a model that returns less is wrong. */
  factor: number;
};

/** One person's tolerance at one time. The denominator of the burden formula. */
export type SlotTolerance = {
  participantId: string;
  slot: TimeSlot;
  toleranceKm: Kilometres;
};

/**
 * The bounded parameters the deterministic funnel runs on.
 *
 * **This is the funnel's input, not "the model's output type".** It has two
 * producers: the deterministic baseline builds it from home locations and
 * `toleranceKm`, and the Context Resolver may then *widen* it. The Resolver
 * falls back to the baseline whenever it is off or fails (spec §4.3), so the
 * funnel never has to know which producer it got.
 *
 * The invariant, which spec §9 requires a unit test for: **the resolved
 * regions always contain the deterministic baseline.** The Resolver may add
 * regions, merge them or enlarge a radius; it may never remove one or shrink
 * below the baseline, because a venue never fetched cannot be recovered by any
 * later stage (spec §4.1g). It may freely *shrink* a tolerance — that only
 * moves a candidate down a list, which the next cycle can undo.
 */
export type ResolvedContext = {
  searchRegions: SearchRegion[];
  detourFactors: DetourFactor[];
  tolerances: SlotTolerance[];
};

/** One weighing cycle of a meeting. Every run is persisted in full (spec §4.1d). */
export type MatchRun = {
  id: string;
  meetingId: string;
  cycleNumber: number;
  /** What went in — venues with their per-participant burdens and viable slots. */
  shortlist: ShortlistEntry[];
  createdAt: Date;
};

/** The venue as it was at decision time. Places data can change afterwards. */
export type VenueSnapshot = {
  placeId: string | null;
  name: string;
  address: string | null;
  location: LatLng | null;
};

/**
 * One of the three ranked options a run produced (spec §4.1c).
 *
 * **Only rank 1 is ever shown.** Ranks 2 and 3 cost almost nothing extra, they
 * give the timeline something to say about what was passed over, and they stay
 * in the candidate set for the next run — but they are never served as the
 * answer to a rejection, which always triggers a fresh run.
 */
export type MatchOption = {
  id: string;
  matchRunId: string;
  rank: number;
  venue: VenueSnapshot;
  /** A machine chose it, so it is an instant. */
  proposedDatetime: Date;
  /** `userId` → the justification written for that viewer specifically (spec §5.6). */
  participantJustifications: Record<string, string>;
  /**
   * What this option trades away, and for whom.
   *
   * Deliberately untyped, like `softPreferences`: the agent writes it, its
   * shape is fixed by A4's JSON Schema at the model boundary, and nothing
   * deterministic branches on it. Persisted for the timeline and the report —
   * and never rendered back as a comparative cost line to the person who bore
   * it (spec §5.6).
   */
  tradeoffs: unknown;
  createdAt: Date;
};
