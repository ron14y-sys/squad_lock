/**
 * The pipeline, end to end, on one made-up evening.
 *
 *   npm run demo                 # filter, one real Gemini call, both post-checks
 *   npm run demo -- --offline    # everything except the call. No key, no quota, no cost
 *   npm run demo -- --fallback   # drop the verified venues, so the "ring ahead" path runs
 *   npm run demo -- --verbose    # list every dropped pair, not just the reasons
 *   npm run demo -- --no-color
 *
 * This is a **demonstration, not a test.** The tests in `lib/matching` and
 * `lib/llm` are what guarantee the behaviour; this exists so the behaviour can
 * be watched happening, on a scenario a person can hold in their head.
 *
 * What it walks through:
 *
 *   1. Four people, carrying between them every kind of hard constraint
 *   2. Six venues — compliant, non-compliant, shut at the wrong hour, unknown
 *   3. A2 `filterPairs` — every dropped pair, and the exact reason
 *   4. A3 `scoreCandidates` — the burden on each person, and the leximin order
 *   5. A4 `runMatchingAgent` — the choice, streamed, with tokens and dollars
 *   6. A2 `assertChosenPairAllowed` on the real answer — the path that passes
 *   7. A2 `assertChosenPairAllowed` on four fabrications — the path that throws
 *
 * Nothing here is imported by the app, and nothing here writes to a database.
 */

import {
  assertChosenPairAllowed,
  filterPairs,
  HardConstraintError,
  viableSlotsByCandidate,
  type ConstraintInput,
  type PairCheck,
  type UnverifiedFact,
  type VenueDietaryFacts,
  type ViablePair,
} from "@/lib/matching/constraints";
import {
  rankByLeximin,
  scoreCandidates,
  type CandidateScore,
} from "@/lib/matching/distance";
import {
  AgentAnswerError,
  runMatchingAgent,
  type MatchOptionDraft,
  type MatchRunDraft,
} from "@/lib/matching/agent";
import {
  LlmConfigError,
  resolveConfig,
  type LlmCallRecord,
} from "@/lib/llm/client";
import { describeTotal, totalCost } from "@/lib/llm/cost";
import { unverifiedNote } from "@/lib/format/hebrew-labels";
import { APP_TIME_ZONE } from "@/lib/types";
import type {
  Candidate,
  Participant,
  PreferenceProfile,
  TimeSlot,
} from "@/lib/types";

/* --------------------------------------------------------------- arguments */

const argv = new Set(process.argv.slice(2));
const OFFLINE = argv.has("--offline");
const FALLBACK = argv.has("--fallback");
const VERBOSE = argv.has("--verbose");
const COLOUR =
  !argv.has("--no-color") &&
  !process.env.NO_COLOR &&
  Boolean(process.stdout.isTTY);

const ESC = "\u001b";
const paint = (code: string) => (text: string) =>
  COLOUR ? `${ESC}[${code}m${text}${ESC}[0m` : text;

const bold = paint("1");
const dim = paint("2");
const red = paint("31");
const green = paint("32");
const yellow = paint("33");
const blue = paint("34");
const magenta = paint("35");

/** Colour codes are printed but not seen, so they must not count as width. */
const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, "g");
/** Pad to a visible width, measuring the text without its colour codes. */
function pad(text: string, width: number): string {
  const visible = text.replace(ANSI, "").length;
  return text + " ".repeat(Math.max(0, width - visible));
}

/* ----------------------------------------------------------------- the cast */

const BASE_PROFILE: Omit<PreferenceProfile, "id" | "userId"> = {
  hardConstraints: { dietary: [], allergies: [], unavailable: [] },
  softPreferences: {
    noiseLevel: "quiet",
    activityStyle: "cultural",
    budget: "modest",
    cuisine: "familiar",
  },
  home: { lat: 32.06, lng: 34.77 },
  homeNeighbourhood: "Florentin",
  toleranceKm: 8,
  recurringMobilityRules: [],
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  updatedAt: new Date("2026-08-01T00:00:00.000Z"),
};

/**
 * One member of the cast: the base profile, with this person's quirks laid
 * over it.
 *
 * `origin` follows the merged profile's `home` rather than the base one, so
 * that the four of them genuinely stand in four different places. Before A3
 * they all shared a coordinate, which was invisible while nothing measured a
 * distance and would have made the burden grid four identical columns.
 */
function person(
  userId: string,
  name: string,
  profile: Partial<PreferenceProfile>,
  rest: Partial<Participant> = {}
): Participant {
  const merged = {
    ...BASE_PROFILE,
    id: `profile-${userId}`,
    userId,
    ...profile,
  };

  return {
    userId,
    name,
    profile: merged,
    context: null,
    origin: merged.home,
    busy: [],
    ...rest,
  };
}

/**
 * Four people, carrying one kind of hard constraint each rather than a
 * realistic scattering, so that every rule in the filter is visibly exercised.
 */
const PARTICIPANTS: Participant[] = [
  person("dana", "Dana", {
    hardConstraints: { dietary: ["kosher"], allergies: [], unavailable: [] },
    home: { lat: 32.056, lng: 34.769 },
    homeNeighbourhood: "Florentin",
  }),
  person("noa", "Noa", {
    hardConstraints: {
      dietary: [],
      allergies: ["shellfish"],
      // She teaches on Monday evenings. Availability, not distance (spec §5.1).
      unavailable: [{ weekdays: ["monday"], from: "20:00", to: "23:00" }],
    },
    home: { lat: 32.063, lng: 34.764 },
    homeNeighbourhood: "Neve Tzedek",
  }),
  person(
    "yotam",
    "Yotam",
    { home: { lat: 32.052, lng: 34.752 }, homeNeighbourhood: "Jaffa" },
    {
      // A free/busy block from Google Calendar — an instant, machine-written.
      busy: [
        {
          start: new Date("2026-09-07T16:30:00.000Z"),
          end: new Date("2026-09-07T18:30:00.000Z"),
        },
      ],
    }
  ),
  person(
    "rami",
    "Rami",
    {
      // Standing rules: no car on Fridays, and the buses stop before Shabbat.
      recurringMobilityRules: [
        { kind: "mode_unavailable", weekdays: ["friday"], mode: "car" },
        { kind: "mode_unavailable", weekdays: ["friday"], mode: "transit" },
      ],
      home: { lat: 32.082, lng: 34.814 },
      homeNeighbourhood: "Ramat Gan",
    },
    {
      // This week only: he is on crutches. An amendment outranks the standing
      // rules (spec §5.7) — and with walking gone too, Friday leaves him no
      // way of travelling at all, whatever the distance.
      context: {
        id: "ctx-rami",
        meetingId: "demo-meeting",
        userId: "rami",
        origin: null,
        originLabel: null,
        mobilityWindows: [
          {
            mode: "walk",
            available: false,
            window: { weekdays: [], from: "00:00", to: "23:59" },
          },
        ],
        softPreferences: null,
        note: "on crutches this week",
        createdAt: new Date("2026-09-05T00:00:00.000Z"),
      },
    }
  ),
];

/* -------------------------------------------------------------- the evening */

type NamedSlot = { id: string; slot: TimeSlot };

/** Written as UTC, annotated with what each one is in `Asia/Jerusalem`. */
const SLOTS: NamedSlot[] = [
  {
    id: "mon-afternoon",
    slot: {
      start: new Date("2026-09-07T12:00:00.000Z"), // Mon 15:00
      end: new Date("2026-09-07T14:00:00.000Z"), //   Mon 17:00
    },
  },
  {
    id: "mon-evening",
    slot: {
      start: new Date("2026-09-07T16:00:00.000Z"), // Mon 19:00
      end: new Date("2026-09-07T18:00:00.000Z"), //   Mon 21:00
    },
  },
  {
    id: "wed-evening",
    slot: {
      start: new Date("2026-09-09T16:00:00.000Z"), // Wed 19:00
      end: new Date("2026-09-09T18:00:00.000Z"), //   Wed 21:00
    },
  },
  {
    id: "fri-evening",
    slot: {
      start: new Date("2026-09-11T17:00:00.000Z"), // Fri 20:00
      end: new Date("2026-09-11T19:00:00.000Z"), //   Fri 22:00
    },
  },
];

/* --------------------------------------------------------------- the venues */

const everyDay = (from: string, to: string) => [{ weekdays: [], from, to }];

const CANDIDATES: Candidate[] = [
  {
    placeId: "v-tavlin",
    name: "Tavlin",
    address: "Nahalat Binyamin 21",
    location: { lat: 32.064, lng: 34.771 },
    neighbourhood: "Florentin",
    rating: 4.3,
    openingHours: everyDay("12:00", "23:00"),
  },
  {
    placeId: "v-hakosem",
    name: "HaKosem",
    address: "Shlomo HaMelech 1",
    location: { lat: 32.075, lng: 34.775 },
    neighbourhood: "Lev Ha'ir",
    rating: 4.1,
    openingHours: everyDay("11:00", "22:00"),
  },
  {
    placeId: "v-basta",
    name: "Basta",
    address: "Rambam 4",
    location: { lat: 32.063, lng: 34.769 },
    neighbourhood: "Kerem HaTeimanim",
    rating: 4.6,
    // Lunch service only: fine at 15:00, shut by every evening slot.
    openingHours: everyDay("12:00", "18:00"),
  },
  {
    placeId: "v-shuk",
    name: "Shuk Bar",
    address: "Levinsky 46",
    location: { lat: 32.058, lng: 34.777 },
    neighbourhood: "Florentin",
    rating: 4.7,
    openingHours: everyDay("17:00", "02:00"),
  },
  {
    placeId: "v-nemal",
    name: "Nemal Grill",
    address: "Hangar 12, the old port",
    location: { lat: 32.096, lng: 34.772 },
    neighbourhood: "Namal",
    rating: 4.5,
    openingHours: everyDay("12:00", "23:00"),
  },
  {
    placeId: "v-mizra",
    name: "Mizra Cafe",
    address: "Yehuda HaLevi 60",
    location: { lat: 32.066, lng: 34.774 },
    neighbourhood: "Lev Ha'ir",
    rating: 4.8,
    // No `openingHours` at all — the ordinary case, not an exotic one.
    // `regularOpeningHours` is an Enterprise-tier Places field against the
    // smallest allowance in the pricing model (spec §6.3), so for most
    // candidates we will simply not have bought the answer.
  },
];

/**
 * What is known about each venue's dietary suitability. Three states per tag:
 * satisfies, violates, and — for anything absent from both lists — not known,
 * which never drops a candidate.
 */
const VENUE_FACTS: Record<string, VenueDietaryFacts> = {
  "v-tavlin": { satisfies: ["kosher", "shellfish"] },
  "v-hakosem": { satisfies: ["kosher", "shellfish"] },
  "v-basta": { satisfies: ["kosher", "shellfish"] },
  "v-shuk": { violates: ["kosher"], satisfies: ["shellfish"] },
  "v-nemal": { violates: ["shellfish"], satisfies: ["kosher"] },
  // v-mizra: nothing known either way.
};

/** `--fallback` removes every fully-verified venue, forcing the "ring ahead" path. */
const VERIFIED_VENUES = ["v-tavlin", "v-hakosem", "v-basta"];

/* --------------------------------------------------------------- formatting */

const WHEN = new Intl.DateTimeFormat("en-GB", {
  timeZone: APP_TIME_ZONE,
  weekday: "short",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const CLOCK = new Intl.DateTimeFormat("en-GB", {
  timeZone: APP_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** A slot in local time, short enough to sit in a table column. */
function whenOf(slot: TimeSlot): string {
  return `${WHEN.format(slot.start)}-${CLOCK.format(slot.end)}`;
}

/** The rule and title that open each of the six stages. */
function heading(step: string, title: string): void {
  console.log(`\n${bold(blue(`-- ${step} `))}${bold(title)}`);
  console.log(dim("-".repeat(74)));
}

const venueById = new Map(CANDIDATES.map((c) => [c.placeId, c]));
const nameOf = (placeId: string) => venueById.get(placeId)?.name ?? placeId;
const idOfSlot = (slot: TimeSlot) =>
  SLOTS.find((s) => s.slot === slot)?.id ?? "unknown-slot";

/**
 * The unverified facts as a phrase: `opening hours, "kosher"` — for this
 * script's own tables. The sentence the *group* sees is A4's
 * `describeUnverified`, and it is deliberately not this.
 */
function unverifiedPhrase(facts: UnverifiedFact[]): string {
  return facts
    .map((f) => (f.kind === "opening_hours" ? "opening hours" : `"${f.tag}"`))
    .join(", ");
}

/* --------------------------------------------------------- 1 · the scenario */

function printScenario(): void {
  heading("1", "The scenario");

  for (const p of PARTICIPANTS) {
    const hc = p.profile.hardConstraints;
    const notes = [
      hc.dietary.length ? `dietary: ${hc.dietary.join(", ")}` : null,
      hc.allergies.length ? `allergy: ${hc.allergies.join(", ")}` : null,
      ...hc.unavailable.map(
        (w) => `unavailable ${w.weekdays.join("/")} ${w.from}-${w.to}`
      ),
      p.busy.length ? `${p.busy.length} calendar block` : null,
      ...p.profile.recurringMobilityRules.map((r) =>
        r.kind === "mode_unavailable"
          ? `no ${r.mode} on ${r.weekdays.join("/")}`
          : `starts from ${r.originLabel}`
      ),
      p.context?.note ? `amendment: ${p.context.note}` : null,
    ].filter(Boolean);

    console.log(
      `  ${bold(pad(p.name, 8))}${dim(p.profile.homeNeighbourhood ?? "")}`
    );
    for (const note of notes) console.log(`    ${dim("·")} ${note}`);
  }

  console.log(
    `\n  ${bold("Slots the group could meet in")} ${dim(APP_TIME_ZONE)}`
  );
  for (const { id, slot } of SLOTS) {
    console.log(`    ${dim("·")} ${pad(whenOf(slot), 30)}${dim(id)}`);
  }
}

/* --------------------------------------------------- 2 · the candidate pool */

function printPool(candidates: Candidate[]): void {
  heading("2", "The candidate pool");

  for (const c of candidates) {
    const facts = VENUE_FACTS[c.placeId];
    const known = [
      c.openingHours
        ? `open ${c.openingHours[0].from}-${c.openingHours[0].to}`
        : yellow("hours unknown"),
      facts?.violates?.length
        ? red(`not ${facts.violates.join("/")}-safe`)
        : null,
      facts?.satisfies?.length
        ? green(`${facts.satisfies.join("/")} ok`)
        : null,
      facts ? null : yellow("nothing known dietary"),
    ].filter(Boolean);

    console.log(
      `  ${bold(pad(c.name, 14))}${dim(pad(`*${c.rating}`, 7))}${known.join(dim(" · "))}`
    );
  }
}

/* -------------------------------------------------------- 3 · the A2 filter */

function printFilter(viable: ViablePair[], dropped: PairCheck[]): void {
  heading("3", "A2 - the hard-constraint filter");

  console.log(
    dim(`  ${pad("", 16)}${SLOTS.map((s) => pad(s.id, 18)).join("")}`)
  );

  const placeIds = [
    ...new Set([
      ...viable.map((v) => v.candidatePlaceId),
      ...dropped.map((d) => d.candidatePlaceId),
    ]),
  ];

  for (const placeId of placeIds) {
    const cells = SLOTS.map(({ slot }) => {
      const ok = viable.find(
        (v) => v.candidatePlaceId === placeId && v.slot === slot
      );
      if (ok) {
        return pad(
          ok.unverified.length === 0 ? green("ok") : yellow("ok *"),
          18
        );
      }
      const bad = dropped.find(
        (d) => d.candidatePlaceId === placeId && d.slot === slot
      );
      return pad(red(bad?.violations[0]?.kind ?? "?"), 18);
    });
    console.log(`  ${bold(pad(nameOf(placeId), 16))}${cells.join("")}`);
  }

  // Grouped, because twenty-four pairs produce forty violation lines and the
  // same sentence six times is not more information than the sentence once.
  // Three of the reasons — unavailable, busy, immobile — are about a person
  // and an hour and have nothing to do with the venue, so they kill the whole
  // column at once and are reported that way.
  const PERSONAL = new Set(["unavailable", "busy", "immobile"]);

  type Group = { detail: string; who?: string; where: string; when: string[] };
  const slotWide = new Map<string, Group>();
  const venueWide = new Map<string, Group>();

  for (const check of dropped) {
    for (const v of check.violations) {
      const personal = PERSONAL.has(v.kind);
      const into = personal ? slotWide : venueWide;
      const key = personal
        ? `${v.kind}|${v.participantId}|${idOfSlot(check.slot)}`
        : `${v.kind}|${v.participantId ?? ""}|${v.candidatePlaceId}`;

      const group = into.get(key);
      if (group) {
        if (!group.when.includes(idOfSlot(check.slot)))
          group.when.push(idOfSlot(check.slot));
      } else {
        into.set(key, {
          detail: v.detail,
          who: v.participantId,
          where: personal
            ? `${v.kind} (${v.participantId})`
            : `${nameOf(v.candidatePlaceId)} - ${v.kind}${v.participantId ? ` (${v.participantId})` : ""}`,
          when: [idOfSlot(check.slot)],
        });
      }
    }
  }

  console.log(
    `\n  ${bold("Why pairs were dropped")}${VERBOSE ? "" : dim("   (--verbose for every pair)")}`
  );

  console.log(
    `\n    ${dim("a person and an hour - kills that slot for every venue")}`
  );
  for (const g of slotWide.values()) {
    console.log(
      `    ${red("x")} ${magenta(pad(g.where, 30))}${dim(g.when.join(", "))}`
    );
    console.log(`      ${dim(g.detail)}`);
  }

  console.log(`\n    ${dim("a venue - kills that venue at the hours listed")}`);
  for (const g of venueWide.values()) {
    console.log(
      `    ${red("x")} ${magenta(pad(g.where, 30))}${dim(g.when.join(", "))}`
    );
    // The detail names the first of those hours; say so rather than let it
    // read as if it were the reason for all of them.
    const more = g.when.length > 1 ? dim("  (and the other hours listed)") : "";
    console.log(`      ${dim(g.detail)}${more}`);
  }

  if (VERBOSE) {
    console.log(`\n    ${dim("every dropped pair")}`);
    for (const check of dropped) {
      console.log(
        `    ${red("x")} ${pad(nameOf(check.candidatePlaceId), 14)}${dim(pad(idOfSlot(check.slot), 16))}${check.violations.map((v) => magenta(v.kind)).join(dim(", "))}`
      );
    }
  }

  const verified = viable.filter((v) => v.unverified.length === 0).length;
  console.log(
    `\n  ${bold(`${viable.length} viable pair(s)`)} of ${viable.length + dropped.length} - ` +
      `${green(`${verified} fully verified`)}, ` +
      `${yellow(`${viable.length - verified} carrying something unchecked`)}`
  );
  for (const pair of viable.filter((p) => p.unverified.length > 0)) {
    console.log(
      `    ${yellow("*")} ${pad(nameOf(pair.candidatePlaceId), 14)}${dim(pad(idOfSlot(pair.slot), 16))}unchecked: ${unverifiedPhrase(pair.unverified)}`
    );
  }
}

/* ------------------------------------------------------ 4 · the A3 fairness */

/**
 * The deterministic fairness layer, over the pairs A2 left standing.
 *
 * Before this stage existed the demo asked the *model* to do this in prose —
 * "prefer the option whose worst-off participant is least badly off" — which
 * spec §4.1f forbids: the model never performs arithmetic and never sorts a
 * candidate set, because that is what keeps `argmin` running over every
 * candidate rather than over whichever ones it happened to weigh carefully.
 * It was also being asked to do it without ever being told a distance.
 */
function rankFairly(viable: ViablePair[], candidates: Candidate[]) {
  const viableSlots = viableSlotsByCandidate({ viable, dropped: [] });
  const survivors = candidates.filter(
    (c) => (viableSlots.get(c.placeId)?.length ?? 0) > 0
  );

  return rankByLeximin(
    scoreCandidates({
      candidates: survivors,
      participants: PARTICIPANTS,
      viableSlots,
    })
  );
}

/** Colour by how far past the person's own stated limit this is. */
function burdenCell(value: number): string {
  const shown = value.toFixed(2);
  if (value <= 1) return green(shown);
  if (value <= 2) return yellow(shown);
  return red(shown);
}

function printFairness(ranked: CandidateScore[]): void {
  heading("4", "A3 - burden and leximin fairness");

  console.log(
    dim(
      `  ${pad("", 16)}${PARTICIPANTS.map((p) => pad(p.name, 10)).join("")}${pad("leximin", 28)}`
    )
  );

  for (const score of ranked) {
    // One column per person, at their most permissive slot - which is the
    // basis the pre-rank uses, so that time-dependence never narrows what
    // gets retrieved (spec §5.4, §4.1g).
    const cells = PARTICIPANTS.map((person) => {
      const best = Math.min(
        ...score.burdens
          .filter((b) => b.participantId === person.userId)
          .map((b) => b.value)
      );
      return pad(burdenCell(best), 10);
    });

    const vector = `[${score.leximin.map((v) => v.toFixed(2)).join(", ")}]`;
    console.log(
      `  ${bold(pad(score.candidate.name, 16))}${cells.join("")}${dim(vector)}`
    );
  }

  console.log(
    dim(
      "\n  Ranked worst-off participant first, ties broken on the second-worst."
    )
  );
  console.log(
    dim(
      "  1.00 is exactly as far as that person said they would travel (spec §5.4)."
    )
  );
  console.log(
    dim(
      "  A straight line with a correction factor - not a routed journey, and"
    )
  );
  console.log(dim("  never a claim about real driving time."));
}

/* ---------------------------------------------------------- 5 · the A1 call */

/**
 * Stage 5: stream the choice out of Gemini and print the cost. Returns `null`
 * under `--offline`, which makes no call at all.
 *
 * **The prompt and the schema are not here.** They live in
 * `lib/matching/agent.ts`, which is A4 — this script used to carry its own
 * copy of both, and two prompts that are meant to be one prompt drift the
 * moment somebody edits the wrong file. What the demo owns is the printing.
 */
async function runAgent(
  viable: ViablePair[],
  ranked: CandidateScore[],
  candidates: Candidate[],
  records: LlmCallRecord[]
): Promise<MatchRunDraft | null> {
  heading("5", "A4 - the matching agent");

  const config = resolveConfig("matching");
  console.log(
    `  ${dim("model")} ${bold(config.model)}   ${dim("thinking")} ${bold(String(config.thinkingLevel))}   ` +
      `${dim("timeout")} ${config.timeoutMs}ms   ${dim("stream")} ${config.stream}`
  );

  if (OFFLINE) {
    console.log(
      `\n  ${yellow("--offline: skipped. No call, no quota, no cost.")}`
    );
    return null;
  }

  console.log(`\n  ${dim("streaming...")}\n`);

  let printed = 0;
  let outcome;
  try {
    outcome = await runMatchingAgent({
      meetingId: "demo-meeting",
      cycleNumber: 1,
      occasion: "a catch-up dinner",
      participants: PARTICIPANTS,
      candidates,
      viable,
      ranked,
      venueFacts: VENUE_FACTS,
      onText: (_chunk, soFar) => {
        // The raw JSON as it arrives. Unlovely, and that is the point: this is
        // what streaming looks like before anything has parsed it.
        process.stdout.write(dim(soFar.slice(printed)));
        printed = soFar.length;
      },
    });
  } catch (error) {
    if (error instanceof LlmConfigError) {
      console.log(`\n  ${yellow(error.message)}`);
      console.log(dim("  Run with --offline to see the rest of the pipeline."));
      return null;
    }
    // A4's three failure modes are three different errors on purpose, and the
    // demo is the place that shows the difference rather than describing it.
    if (error instanceof AgentAnswerError) {
      console.log(
        `\n  ${red("the answer was refused")}  ${dim(error.message)}`
      );
      return null;
    }
    if (error instanceof HardConstraintError) {
      console.log(`\n  ${red("the answer broke a hard constraint")}`);
      for (const v of error.violations) {
        console.log(`      ${magenta(pad(v.kind, 18))}${dim(v.detail)}`);
      }
      return null;
    }
    throw error;
  }

  records.push(outcome.call);
  console.log("");

  console.log(`\n  ${bold("What came back")}`);
  for (const option of outcome.draft.options) {
    const badge =
      option.unverified.length > 0 ? yellow("unverified") : green("verified");
    console.log(
      `    ${bold(`#${option.rank}`)} ${bold(pad(option.venue.name, 14))}` +
        `${dim(pad(whenOf({ start: option.proposedDatetime, end: option.proposedEnd }), 20))}${badge}`
    );
    if (option.rank === 1) {
      for (const [userId, reason] of Object.entries(
        option.participantJustifications
      )) {
        const who =
          PARTICIPANTS.find((p) => p.userId === userId)?.name ?? userId;
        console.log(`        ${dim(`${who}:`)} ${reason}`);
      }
      const traded = (option.tradeoffs as { tradedAway?: string }).tradedAway;
      console.log(
        `        ${dim(`traded away (internal, never shown): ${traded || "nothing"}`)}`
      );
    }
  }

  return outcome.draft;
}

/**
 * The disclaimer, rendered from A2's flag rather than from anything the model
 * said. A4 writes the sentence when it builds the option; nothing here decides
 * whether there is one.
 */
function printDisclaimer(chosen: MatchOptionDraft): void {
  console.log(`\n  ${bold("What the group would see")}`);
  console.log(
    `    ${bold(chosen.venue.name)}, ${whenOf({ start: chosen.proposedDatetime, end: chosen.proposedEnd })}`
  );

  const note = unverifiedNote(chosen.unverified);
  if (!note) {
    console.log(
      `    ${green("Everything about this one is confirmed - no note needed.")}`
    );
    console.log(
      dim(
        "    (--fallback removes the verified venues, to see the note itself)"
      )
    );
    return;
  }

  // The real Hebrew sentence, from the formatting layer — this is the line
  // the group actually reads on their phone.
  console.log(`    ${yellow("*")} ${note}`);
}

/* ------------------------------------------------------ 5 & 6 · the post-check */

function printPostCheck(
  chosen: MatchOptionDraft | null,
  input: ConstraintInput,
  viable: ViablePair[]
): void {
  heading("6", "A2 - the post-check on the answer");

  // A4 has already run this check — a draft that exists is a draft that
  // passed. Running it again in the open is the point of a demonstration.
  //
  // With no call made, stand in the pair the filter itself blessed, so the
  // passing path is still shown.
  const venueId = chosen?.venue.placeId ?? viable[0].candidatePlaceId;
  const slot =
    viable.find(
      (pair) =>
        pair.candidatePlaceId === venueId &&
        (!chosen ||
          pair.slot.start.getTime() === chosen.proposedDatetime.getTime())
    )?.slot ?? viable[0].slot;

  try {
    assertChosenPairAllowed({ candidatePlaceId: venueId, slot }, input);
    console.log(
      `  ${green("passed")}  ${nameOf(venueId)} at ${idOfSlot(slot)}` +
        (chosen ? "" : dim("   (stand-in - no call was made)"))
    );
  } catch (error) {
    console.log(`  ${red("the agent's own answer was rejected")}`);
    console.log(`    ${red(String(error))}`);
  }

  heading("7", "A2 - the post-check on four answers that must not pass");

  // Always against the full pool, whatever `--fallback` did to the run above:
  // each of these is meant to demonstrate a different rule, and against a
  // trimmed pool they would all collapse into "that venue is not a candidate".
  const fullPool: ConstraintInput = {
    candidates: CANDIDATES,
    participants: PARTICIPANTS,
    slots: SLOTS.map((s) => s.slot),
    venueFacts: VENUE_FACTS,
  };

  const fabrications: {
    label: string;
    pair: { candidatePlaceId: string; slot: TimeSlot };
  }[] = [
    {
      label: "a venue that does not exist",
      pair: { candidatePlaceId: "v-somewhere-lovely", slot: SLOTS[0].slot },
    },
    {
      label: "a time nobody offered",
      pair: {
        candidatePlaceId: "v-tavlin",
        slot: {
          start: new Date("2026-09-13T01:00:00.000Z"),
          end: new Date("2026-09-13T03:00:00.000Z"),
        },
      },
    },
    {
      label: "the venue Dana cannot eat at",
      pair: { candidatePlaceId: "v-shuk", slot: SLOTS[2].slot },
    },
    {
      label: "a venue that is shut at that hour",
      pair: { candidatePlaceId: "v-basta", slot: SLOTS[2].slot },
    },
  ];

  for (const { label, pair } of fabrications) {
    try {
      assertChosenPairAllowed(pair, fullPool);
      console.log(`  ${red(`NOT CAUGHT - ${label}`)}`);
    } catch (error) {
      if (!(error instanceof HardConstraintError)) throw error;
      console.log(`  ${green("caught")}  ${dim(label)}`);
      for (const v of error.violations) {
        console.log(`      ${magenta(pad(v.kind, 18))}${dim(v.detail)}`);
      }
    }
  }
}

/* --------------------------------------------------------------------- main */

async function main(): Promise<void> {
  console.log(bold("\nSquadLock - the matching pipeline, end to end"));
  const flags = [OFFLINE ? "offline" : null, FALLBACK ? "fallback" : null]
    .filter(Boolean)
    .join(" · ");
  console.log(
    dim(
      `A2 filters, A3 ranks, A4 chooses, A2 checks the choice.   ${flags ? `${flags} · ` : ""}${APP_TIME_ZONE}`
    )
  );

  const candidates = FALLBACK
    ? CANDIDATES.filter((c) => !VERIFIED_VENUES.includes(c.placeId))
    : CANDIDATES;

  const input: ConstraintInput = {
    candidates,
    participants: PARTICIPANTS,
    slots: SLOTS.map((s) => s.slot),
    venueFacts: VENUE_FACTS,
  };

  printScenario();
  printPool(candidates);

  const { viable, dropped } = filterPairs(input);
  printFilter(viable, dropped);

  if (viable.length === 0) {
    console.log(`\n  ${red("Nothing survived the filter.")}`);
    console.log(
      dim(
        "  A real run goes to `stuck` here (A8). It does not propose something bad."
      )
    );
    return;
  }

  const ranked = rankFairly(viable, candidates);
  printFairness(ranked);

  const records: LlmCallRecord[] = [];
  const draft = await runAgent(viable, ranked, candidates, records);
  const top = draft?.options.find((option) => option.rank === 1) ?? null;

  if (top) printDisclaimer(top);
  printPostCheck(top, input, viable);

  if (records.length > 0) {
    const total = totalCost(records.map((r) => r.cost));
    console.log(`\n${dim("-".repeat(74))}`);
    console.log(
      `  ${bold("This run cost")} ${describeTotal(total)} ` +
        dim(`across ${records.length} call(s) - ${total.models.join(", ")}`)
    );
  }
  console.log("");
}

main().catch((error) => {
  console.error(`\n${red("the demo failed")}\n`, error);
  process.exitCode = 1;
});
