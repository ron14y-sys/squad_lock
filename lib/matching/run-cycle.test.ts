import { describe, expect, it } from "vitest";

import {
  blockedByRejections,
  EXTERNAL_RATE_LIMIT_COOLDOWN_MS,
  faultRetryNotBefore,
  isDue,
  MIN_PROPOSAL_LIFETIME_MS,
  partOfDayWindows,
  RATE_LIMIT_RETRY_COOLDOWN_MS,
  CONTEXT_BATCH_MS,
  RUN_ATTEMPT_COOLDOWN_MS,
  SEARCH_HORIZON_DAYS,
  searchWindow,
  type DueInput,
  type PriorProposal,
  type RecordedRejection,
  venueDietaryFactsFrom,
  venueSoftFactsFrom,
} from "./run-cycle";
import { checkPair } from "./constraints";
import { ExternalRateLimitError } from "@/lib/external/rate-limit";
import { LlmCallError } from "@/lib/llm/client";
import { pairId } from "./schemas";

/**
 * A8b's two rules, with no database and no clock.
 *
 * The scenario throughout is one meeting: the group is offered Asian at
 * 20:00, somebody says no, they are offered Italian at 20:00, somebody says
 * no again. What may the third proposal contain?
 */

const at = (iso: string) => new Date(iso);

const EVENING = {
  start: at("2026-09-24T17:00:00.000Z"),
  end: at("2026-09-24T20:00:00.000Z"),
};
const LATER = {
  start: at("2026-09-24T20:00:00.000Z"),
  end: at("2026-09-24T23:00:00.000Z"),
};

const asian: PriorProposal = {
  at: at("2026-09-24T15:00:00.000Z"),
  placeId: "asian",
  slot: EVENING,
};
const italian: PriorProposal = {
  at: at("2026-09-24T16:00:00.000Z"),
  placeId: "italian",
  slot: EVENING,
};

const rejection = (
  iso: string,
  outcome: RecordedRejection["outcome"]
): RecordedRejection => ({ at: at(iso), outcome });

describe("blockedByRejections", () => {
  it("blocks nothing on a meeting with no history", () => {
    const blocked = blockedByRejections([], []);

    expect(blocked.venues.size).toBe(0);
    expect(blocked.pairs.size).toBe(0);
  });

  // #17: "the option just rejected may not be re-proposed". Doing it for
  // every earlier proposal costs nothing and closes the case where one comes
  // back two cycles later as though nobody had said anything.
  it("never repeats a proposal, whichever cycle it was made in", () => {
    const blocked = blockedByRejections([asian, italian], []);

    expect([...blocked.pairs]).toEqual([
      pairId("asian", EVENING),
      pairId("italian", EVENING),
    ]);
  });

  it("blocks the whole venue when the objection was the venue itself", () => {
    const blocked = blockedByRejections(
      [asian],
      [rejection("2026-09-24T15:30:00.000Z", "venue_identity")]
    );

    expect(blocked.venues.has("asian")).toBe(true);
  });

  // "Too loud" and "too expensive" are properties of the place. Offering it
  // again three hours earlier does not answer the objection.
  it("blocks the whole venue for a soft objection too", () => {
    const blocked = blockedByRejections(
      [asian],
      [rejection("2026-09-24T15:30:00.000Z", "soft")]
    );

    expect(blocked.venues.has("asian")).toBe(true);
  });

  // The opposite case, and the reason the rule is not just "block the
  // venue": the same venue earlier is exactly the right next answer.
  it("leaves the venue open when the objection was the hour", () => {
    const blocked = blockedByRejections(
      [{ ...asian, slot: LATER }],
      [rejection("2026-09-24T15:30:00.000Z", "time")]
    );

    expect(blocked.venues.size).toBe(0);
    expect(blocked.pairs.has(pairId("asian", LATER))).toBe(true);
    expect(blocked.pairs.has(pairId("asian", EVENING))).toBe(false);
  });

  // Reach varies by hour — "no car after 21:00" (#89) — so "too far" is the
  // other objection that is about the evening rather than the place.
  it("leaves the venue open for a distance objection", () => {
    const blocked = blockedByRejections(
      [asian],
      [rejection("2026-09-24T15:30:00.000Z", "distance")]
    );

    expect(blocked.venues.size).toBe(0);
  });

  it("blocks only the pair when nothing was understood", () => {
    for (const outcome of [
      "none",
      "failed_quota",
      "failed_call",
      null,
    ] as const) {
      const blocked = blockedByRejections(
        [asian],
        [rejection("2026-09-24T15:30:00.000Z", outcome)]
      );

      expect(blocked.venues.size, `outcome ${outcome}`).toBe(0);
      expect(blocked.pairs.has(pairId("asian", EVENING))).toBe(true);
    }
  });

  // The whole reason the outcome is stored per row rather than read off
  // Response.extractionOutcome, which only ever holds the last one: each
  // rejection is about whatever was on screen when it was written.
  it("blocks the venue that was on screen, not the newest one", () => {
    const blocked = blockedByRejections(
      [asian, italian],
      [
        rejection("2026-09-24T15:30:00.000Z", "venue_identity"),
        rejection("2026-09-24T16:30:00.000Z", "venue_identity"),
      ]
    );

    expect([...blocked.venues].sort()).toEqual(["asian", "italian"]);
  });

  // Ron's scenario: "no Asian" in cycle 1, "no Italian" in cycle 2. The
  // third proposal may be neither — before A8 the first sentence had been
  // overwritten in the database and Asian could come back.
  it("keeps cycle 1's venue blocked through cycle 3", () => {
    const blocked = blockedByRejections(
      [asian, italian],
      [
        rejection("2026-09-24T15:30:00.000Z", "venue_identity"),
        rejection("2026-09-24T16:30:00.000Z", "venue_identity"),
      ]
    );

    expect(blocked.venues.has("asian")).toBe(true);
  });
});

describe("searchWindow", () => {
  const NOW = at("2026-09-20T09:00:00.000Z");

  it("looks a week ahead when no date was pinned, a minute short of it", () => {
    const window = searchWindow(null, NOW);

    expect(window.start).toEqual(NOW);
    // A full week would end where it starts on the weekly axis, which
    // `constraints.ts` cannot place — and a group free all week would get
    // that whole window as one slot.
    expect(window.end.getTime() - NOW.getTime()).toBe(
      7 * 24 * 60 * 60 * 1000 - 60 * 1000
    );
  });

  // A @db.Date is midnight UTC on that calendar day; Asia/Jerusalem is two
  // or three hours ahead, so the local day starts before that instant.
  it("covers the pinned day in APP_TIME_ZONE, not the UTC one", () => {
    const window = searchWindow(at("2026-09-24T00:00:00.000Z"), NOW);

    expect(window.start.toISOString()).toBe("2026-09-23T21:00:00.000Z");
    expect(window.end.toISOString()).toBe("2026-09-24T21:00:00.000Z");
  });

  it("does not propose a pinned day's hours that have already passed", () => {
    const midday = at("2026-09-24T09:00:00.000Z");
    const window = searchWindow(at("2026-09-24T00:00:00.000Z"), midday);

    expect(window.start).toEqual(midday);
  });
});

describe("partOfDayWindows (#168)", () => {
  it("narrows a pinned day to the part's local hours, as one window", () => {
    const window = searchWindow(
      at("2026-09-24T00:00:00.000Z"),
      at("2026-09-20T09:00:00.000Z")
    );

    expect(partOfDayWindows(window, "evening")).toEqual([
      {
        start: at("2026-09-24T15:00:00.000Z"),
        end: at("2026-09-24T20:00:00.000Z"),
      },
    ]);
  });

  it("excludes a pinned day whose part has already fully passed", () => {
    // Evening ends at 20:00 UTC on the pinned day (23:00 local) — a moment
    // at exactly that instant is a pinned day already entirely spent.
    const window = searchWindow(
      at("2026-09-24T00:00:00.000Z"),
      at("2026-09-24T21:00:00.000Z")
    );

    expect(partOfDayWindows(window, "evening")).toEqual([]);
  });

  it("splits a week-long, no-date horizon into one window per day", () => {
    const now = at("2026-09-20T09:00:00.000Z"); // noon local
    const window = searchWindow(null, now);

    const windows = partOfDayWindows(window, "morning");

    // Today's morning (08:00-12:00 local) is already over at noon — the
    // horizon contributes exactly SEARCH_HORIZON_DAYS windows, not one per
    // calendar day it spans.
    expect(windows).toHaveLength(SEARCH_HORIZON_DAYS);
    expect(windows[0]).toEqual({
      start: at("2026-09-21T05:00:00.000Z"),
      end: at("2026-09-21T09:00:00.000Z"),
    });
    // The last day is clipped to the outer window's own end, one minute
    // short of a full week — same rule `searchWindow` itself states.
    expect(windows[windows.length - 1]).toEqual({
      start: at("2026-09-27T05:00:00.000Z"),
      end: at("2026-09-27T08:59:00.000Z"),
    });
  });

  it("keeps every window inside the outer bounds and in order", () => {
    const window = searchWindow(null, at("2026-09-20T09:00:00.000Z"));
    const windows = partOfDayWindows(window, "midday");

    for (const slot of windows) {
      expect(slot.start.getTime()).toBeGreaterThanOrEqual(
        window.start.getTime()
      );
      expect(slot.end.getTime()).toBeLessThanOrEqual(window.end.getTime());
      expect(slot.end.getTime()).toBeGreaterThan(slot.start.getTime());
    }
    for (let i = 1; i < windows.length; i++) {
      expect(windows[i]!.start.getTime()).toBeGreaterThan(
        windows[i - 1]!.end.getTime()
      );
    }
  });
});

/**
 * The three timers, without a database or a clock.
 *
 * `NOW` is the moment a poll arrives. Everything else is expressed as an
 * offset from it, so a change to one of the constants moves the tests with it
 * rather than breaking them.
 */
describe("isDue", () => {
  const NOW = at("2026-09-27T20:00:00.000Z");
  const ago = (ms: number) => new Date(NOW.getTime() - ms);

  const long = 10 * 60_000; // comfortably past every window

  const due: DueInput = {
    updatedAt: ago(long),
    lastRunAt: ago(long),
    firstUnseenContextAt: ago(CONTEXT_BATCH_MS + 1000),
    retryNotBefore: null,
  };

  it("runs a meeting whose batch window has closed", () => {
    expect(isDue(due, NOW)).toBe(true);
  });

  // The guard against C5's own polling: a run takes 6-23s and the feed asks
  // every 3s, so without this about five polls would each start their own.
  it("leaves a meeting alone while another poll may still be running it", () => {
    expect(isDue({ ...due, updatedAt: ago(1000) }, NOW)).toBe(false);
    expect(
      isDue({ ...due, updatedAt: ago(RUN_ATTEMPT_COOLDOWN_MS - 1) }, NOW)
    ).toBe(false);
  });

  it("waits out the batch window so several rejections are answered together", () => {
    expect(
      isDue({ ...due, firstUnseenContextAt: ago(CONTEXT_BATCH_MS - 1) }, NOW)
    ).toBe(false);
  });

  // B11: `firstUnseenContextAt` does not know or care whether the row it
  // is handed was a rejection or an amendment -- `runDueMeetings` is what
  // decides which rows qualify, and this is the same timer either way.
  it("B11: the same batch window answers an amendment, not only a rejection", () => {
    expect(
      isDue({ ...due, firstUnseenContextAt: ago(CONTEXT_BATCH_MS - 1) }, NOW)
    ).toBe(false);
    expect(
      isDue({ ...due, firstUnseenContextAt: ago(CONTEXT_BATCH_MS + 1) }, NOW)
    ).toBe(true);
  });

  // The window is anchored to the FIRST unanswered rejection, so a later one
  // cannot push the answer further away.
  it("does not restart the window when a second rejection arrives", () => {
    const first = ago(CONTEXT_BATCH_MS + 60_000);

    expect(isDue({ ...due, firstUnseenContextAt: first }, NOW)).toBe(true);
  });

  // A rejection written while a run was in flight is OLDER than the run that
  // never saw it, so no timestamp comparison finds it. `runDueMeetings` asks
  // MatchRunSeenContext instead, and `runCycle` leaves such a meeting in
  // `weighing` on purpose — this is that meeting arriving at the next poll,
  // with a proposal already out and a rejection still unanswered.
  it("answers a rejection that arrived mid-run, though it predates the run", () => {
    const runFinished = ago(MIN_PROPOSAL_LIFETIME_MS + 1000);
    const rejectedDuringIt = new Date(runFinished.getTime() - 10_000);

    expect(
      isDue(
        {
          updatedAt: ago(RUN_ATTEMPT_COOLDOWN_MS + 1000),
          lastRunAt: runFinished,
          firstUnseenContextAt: rejectedDuringIt,
          retryNotBefore: null,
        },
        NOW
      )
    ).toBe(true);
  });

  it("gives every proposal its time on screen before replacing it", () => {
    const fresh = ago(MIN_PROPOSAL_LIFETIME_MS - 1);

    expect(
      isDue(
        {
          updatedAt: ago(long),
          lastRunAt: fresh,
          firstUnseenContextAt: ago(1),
          retryNotBefore: null,
        },
        NOW
      )
    ).toBe(false);
  });

  it("is not due when a proposal is out and nobody has objected", () => {
    expect(isDue({ ...due, firstUnseenContextAt: null }, NOW)).toBe(false);
  });

  // Normally step 7 runs the first cycle at initiation. Reaching here with no
  // run at all means that one failed, so this is the retry.
  it("retries a meeting that has never had a run", () => {
    expect(
      isDue(
        {
          updatedAt: ago(long),
          lastRunAt: null,
          firstUnseenContextAt: null,
          retryNotBefore: null,
        },
        NOW
      )
    ).toBe(true);
  });

  // B9 part two: a rate-limited fault's cooldown, not the flat one.
  describe("retryNotBefore", () => {
    it("is not due before a set retryNotBefore, even though the flat cooldown has long passed", () => {
      expect(isDue({ ...due, retryNotBefore: ago(-1000) }, NOW)).toBe(false);
    });

    it("is due once retryNotBefore has passed", () => {
      expect(isDue({ ...due, retryNotBefore: ago(1000) }, NOW)).toBe(true);
    });

    it("is due exactly at the retryNotBefore boundary", () => {
      expect(isDue({ ...due, retryNotBefore: NOW }, NOW)).toBe(true);
    });

    it("is unaffected when null, same as every meeting that never rate-limited", () => {
      expect(isDue({ ...due, retryNotBefore: null }, NOW)).toBe(true);
    });
  });
});

describe("faultRetryNotBefore", () => {
  const NOW = at("2026-09-27T20:00:00.000Z");

  it("B9 part four: uses the service's own Retry-After for a Calendar or Places rate limit", () => {
    const error = new ExternalRateLimitError("places", "429", 45_000);
    expect(faultRetryNotBefore(error, NOW)).toEqual(
      new Date(NOW.getTime() + 45_000)
    );
  });

  it("B9 part four: falls back to EXTERNAL_RATE_LIMIT_COOLDOWN_MS when the 429 sent no delay", () => {
    const error = new ExternalRateLimitError("calendar", "429", null);
    expect(faultRetryNotBefore(error, NOW)).toEqual(
      new Date(NOW.getTime() + EXTERNAL_RATE_LIMIT_COOLDOWN_MS)
    );
  });

  it("is null for an error that is not an LlmCallError", () => {
    expect(
      faultRetryNotBefore(new Error("places: searchNearby failed (500)"), NOW)
    ).toBeNull();
  });

  it("is null for an LlmCallError that is not rate-limited and gives no delay", () => {
    const error = new LlmCallError("overloaded", {
      model: "gemini-3.5-flash-lite",
      task: "matching",
      rateLimited: false,
    });
    expect(faultRetryNotBefore(error, NOW)).toBeNull();
  });

  it("uses Gemini's own delay even when not flagged rate-limited", () => {
    const error = new LlmCallError("high demand, retry in 12s", {
      model: "gemini-3.5-flash-lite",
      task: "matching",
      rateLimited: false,
    });
    expect(faultRetryNotBefore(error, NOW)).toEqual(
      new Date(NOW.getTime() + 12_000)
    );
  });

  it("falls back to RATE_LIMIT_RETRY_COOLDOWN_MS when rate-limited with no explicit delay", () => {
    const error = new LlmCallError("RESOURCE_EXHAUSTED", {
      model: "gemini-3.5-flash-lite",
      task: "matching",
      rateLimited: true,
    });
    expect(faultRetryNotBefore(error, NOW)).toEqual(
      new Date(NOW.getTime() + RATE_LIMIT_RETRY_COOLDOWN_MS)
    );
  });

  it("prefers Gemini's own delay over the default even when rate-limited", () => {
    const error = new LlmCallError("quota exceeded, retry in 45s", {
      model: "gemini-3.5-flash-lite",
      task: "matching",
      rateLimited: true,
    });
    expect(faultRetryNotBefore(error, NOW)).toEqual(
      new Date(NOW.getTime() + 45_000)
    );
  });
});

describe("venueSoftFactsFrom", () => {
  it("keeps only the venues whose budget is known, keyed by place id", () => {
    const facts = venueSoftFactsFrom([
      { placeId: "cheap", budget: "modest" },
      { placeId: "unknown" },
      { placeId: "dear", budget: "splurge" },
    ]);

    expect(facts).toEqual({
      cheap: { budget: "modest" },
      dear: { budget: "splurge" },
    });
    expect(facts).not.toHaveProperty("unknown");
  });

  it("is undefined, not an empty object, when nothing is known about any venue", () => {
    // An empty object would tell the agent that nothing is true of these
    // venues, rather than that nothing is known about them (#86, #139).
    expect(
      venueSoftFactsFrom([{ placeId: "a" }, { placeId: "b" }])
    ).toBeUndefined();
    expect(venueSoftFactsFrom([])).toBeUndefined();
  });
});

describe("venueDietaryFactsFrom", () => {
  it("is undefined when Google said nothing about any venue", () => {
    expect(venueDietaryFactsFrom([{ placeId: "a" }])).toBeUndefined();
    expect(venueDietaryFactsFrom([])).toBeUndefined();
  });

  it("leaves out a venue Google said nothing about", () => {
    const facts = venueDietaryFactsFrom([
      { placeId: "veg", servesVegetarianFood: true },
      { placeId: "unknown" },
    ]);
    expect(Object.keys(facts!)).toEqual(["veg"]);
  });

  describe("against a participant's tags (checkPair)", () => {
    const candidate = {
      placeId: "p",
      name: "Cafe",
      address: null,
      location: { lat: 32.08, lng: 34.78 },
      neighbourhood: null,
    };
    const slot = {
      start: new Date("2026-10-08T17:00:00Z"),
      end: new Date("2026-10-08T19:00:00Z"),
    };
    function person(dietary: string[]) {
      return {
        userId: "u1",
        name: "Dana",
        profile: {
          hardConstraints: { dietary, allergies: [], unavailable: [] },
          softPreferences: {},
          home: { lat: 32.08, lng: 34.78 },
          toleranceKm: 5,
          recurringMobilityRules: [],
        },
        context: null,
        origin: { lat: 32.08, lng: 34.78 },
        busy: [],
      } as unknown as Parameters<typeof checkPair>[2][number];
    }
    function check(dietary: string[], servesVegetarianFood?: boolean) {
      const facts = venueDietaryFactsFrom([
        { placeId: "p", servesVegetarianFood },
      ]);
      const result = checkPair(candidate, slot, [person(dietary)], facts?.p);
      // The test venue has no opening hours; only the dietary side is asked.
      return {
        violations: result.violations,
        unverified: result.unverified.filter((f) => f.kind === "dietary"),
      };
    }

    it("verifies a vegetarian ('צמחוני') when Google says the place serves it", () => {
      const result = check(["צמחוני"], true);
      expect(result.violations).toEqual([]);
      expect(result.unverified).toEqual([]);
    });

    it("refuses a vegetarian or a vegan when Google says it does not", () => {
      expect(check(["צמחוני"], false).violations).toHaveLength(1);
      expect(check(["טבעוני"], false).violations).toHaveLength(1);
    });

    it("does not count vegetarian as vegan, nor say anything about kosher", () => {
      expect(check(["טבעוני", "כשר"], true).unverified).toEqual([
        { kind: "dietary", tag: "טבעוני" },
        { kind: "dietary", tag: "כשר" },
      ]);
    });

    it("leaves a vegetarian unverified when Google did not say", () => {
      expect(check(["צמחוני"]).unverified).toEqual([
        { kind: "dietary", tag: "צמחוני" },
      ]);
    });
  });
});
