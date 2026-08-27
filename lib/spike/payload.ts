/**
 * A fabricated worst-case payload for the F2 runtime measurement.
 *
 * "Worst case" means the largest run the product allows, not a convenient one:
 * six participants (the biggest realistic group), 24 shortlisted candidates
 * (the top of the range B7c produces), full hard and soft constraints, real
 * free/busy blocks, and a rejection history — because a cycle-3 run carries one
 * and is therefore the longest run the system can ask for.
 *
 * These types are the *model payload* shape — flattened, snake_case, with
 * distances precomputed — not the shared vocabulary. That lives in
 * `lib/types/` (issue #4). This file is frozen as the input the F2 measurement
 * in docs/decisions/runtime-budget.md actually ran on; A1 replaces it.
 *
 * None of this is real data. Coordinates are approximate Tel Aviv
 * neighbourhoods; venue names are invented. Nothing here is a claim about a
 * real restaurant.
 */

export type Participant = {
  id: string;
  name: string;
  home_neighbourhood: string;
  home_lat: number;
  home_lng: number;
  tolerance_km: number;
  hard_constraints: string[];
  soft_preferences: string[];
  recurring_mobility: string[];
  busy: string[];
};

export type Candidate = {
  id: string;
  name: string;
  type: string;
  neighbourhood: string;
  lat: number;
  lng: number;
  opening_hours: string;
  attributes: string[];
  distances_km: Record<string, number>;
};

export type MatchPayload = {
  occasion: string;
  cycle: number;
  rejection_history: { participant_id: string; reason: string }[];
  participants: Participant[];
  candidates: Candidate[];
};

const PARTICIPANTS: Participant[] = [
  {
    id: "p1",
    name: "Noa",
    home_neighbourhood: "Florentin, Tel Aviv",
    home_lat: 32.0553,
    home_lng: 34.7649,
    tolerance_km: 3.5,
    hard_constraints: ["no shellfish — severe allergy"],
    soft_preferences: [
      "loud places are fine",
      "prefers small plates over a set menu",
      "likes outdoor seating",
    ],
    recurring_mobility: ["no car on Fridays — walks or takes a scooter"],
    busy: [
      "2026-09-01T09:00/2026-09-01T18:00",
      "2026-09-02T09:00/2026-09-02T18:00",
      "2026-09-02T19:30/2026-09-02T22:00",
      "2026-09-03T09:00/2026-09-03T17:30",
      "2026-09-04T08:00/2026-09-04T14:00",
    ],
  },
  {
    id: "p2",
    name: "Itai",
    home_neighbourhood: "Ramat Gan, near the diamond exchange",
    home_lat: 32.0838,
    home_lng: 34.8065,
    tolerance_km: 6,
    hard_constraints: ["kosher only — teudat kashrut required"],
    soft_preferences: [
      "prefers a table he can book",
      "dislikes standing-room bars",
      "meat over fish",
    ],
    recurring_mobility: [
      "drives, but avoids central Tel Aviv parking on weeknights",
    ],
    busy: [
      "2026-09-01T08:30/2026-09-01T19:00",
      "2026-09-02T08:30/2026-09-02T19:00",
      "2026-09-03T08:30/2026-09-03T19:00",
      "2026-09-03T20:30/2026-09-03T23:00",
      "2026-09-04T08:30/2026-09-04T15:00",
    ],
  },
  {
    id: "p3",
    name: "Maya",
    home_neighbourhood: "Givatayim",
    home_lat: 32.0723,
    home_lng: 34.8115,
    tolerance_km: 4,
    hard_constraints: ["vegetarian — needs at least two real main courses"],
    soft_preferences: [
      "quiet enough to hold a conversation",
      "prefers earlier evenings",
      "no smoking section nearby",
    ],
    recurring_mobility: [
      "relies on public transport, so nothing that ends after the last bus",
    ],
    busy: [
      "2026-09-01T07:30/2026-09-01T16:00",
      "2026-09-01T18:00/2026-09-01T21:00",
      "2026-09-02T07:30/2026-09-02T16:00",
      "2026-09-03T07:30/2026-09-03T16:00",
      "2026-09-04T07:30/2026-09-04T16:00",
    ],
  },
  {
    id: "p4",
    name: "Daniel",
    home_neighbourhood: "Neve Tzedek, Tel Aviv",
    home_lat: 32.0625,
    home_lng: 34.7623,
    tolerance_km: 2,
    hard_constraints: ["gluten-free — coeliac, cross-contamination matters"],
    soft_preferences: [
      "walks everywhere, so close beats good",
      "likes wine lists",
      "hates places that do not take reservations",
    ],
    recurring_mobility: ["no car at all"],
    busy: [
      "2026-09-01T10:00/2026-09-01T17:00",
      "2026-09-02T10:00/2026-09-02T17:00",
      "2026-09-02T18:30/2026-09-02T23:00",
      "2026-09-03T10:00/2026-09-03T17:00",
      "2026-09-04T10:00/2026-09-04T13:00",
    ],
  },
  {
    id: "p5",
    name: "Shira",
    home_neighbourhood: "Bat Yam",
    home_lat: 32.0171,
    home_lng: 34.7509,
    tolerance_km: 9,
    hard_constraints: [],
    soft_preferences: [
      "does not mind travelling if the place is worth it",
      "prefers seafood",
      "likes a late start",
    ],
    recurring_mobility: [
      "drives on weekdays; on Thursdays the car goes to her partner",
    ],
    busy: [
      "2026-09-01T09:00/2026-09-01T18:30",
      "2026-09-02T09:00/2026-09-02T18:30",
      "2026-09-03T09:00/2026-09-03T18:30",
      "2026-09-03T21:00/2026-09-03T23:30",
      "2026-09-04T09:00/2026-09-04T18:30",
    ],
  },
  {
    id: "p6",
    name: "Yonatan",
    home_neighbourhood: "Herzliya",
    home_lat: 32.1624,
    home_lng: 34.8443,
    tolerance_km: 12,
    hard_constraints: ["nut allergy — no nuts in the kitchen at all"],
    soft_preferences: [
      "will drive, but wants it to be worth the drive",
      "prefers places with parking",
      "dislikes very small rooms",
    ],
    recurring_mobility: ["drives; leaves the office in Herzliya Pituach"],
    busy: [
      "2026-09-01T08:00/2026-09-01T19:30",
      "2026-09-02T08:00/2026-09-02T19:30",
      "2026-09-03T08:00/2026-09-03T19:00",
      "2026-09-04T08:00/2026-09-04T19:30",
      "2026-09-04T20:30/2026-09-04T23:00",
    ],
  },
];

const RAW_CANDIDATES: Omit<Candidate, "distances_km">[] = [
  {
    id: "v01",
    name: "Beit Hakerem Bistro",
    type: "bistro",
    neighbourhood: "Florentin",
    lat: 32.0561,
    lng: 34.7688,
    opening_hours: "Sun-Thu 18:00-00:00, Fri 12:00-16:00, Sat closed",
    attributes: ["vegetarian mains", "gluten-free kitchen", "outdoor seating"],
  },
  {
    id: "v02",
    name: "Ha'Mitbach Shel Rina",
    type: "mediterranean",
    neighbourhood: "Neve Tzedek",
    lat: 32.0632,
    lng: 34.7641,
    opening_hours: "Sun-Thu 17:30-23:30, Fri 12:00-15:00, Sat 19:00-23:00",
    attributes: ["kosher", "reservations", "quiet"],
  },
  {
    id: "v03",
    name: "Shuk Ba'Layla",
    type: "small plates",
    neighbourhood: "Levinsky",
    lat: 32.0578,
    lng: 34.7752,
    opening_hours: "Sun-Thu 19:00-01:00, Fri 19:00-02:00, Sat 19:00-01:00",
    attributes: ["small plates", "loud", "no reservations"],
  },
  {
    id: "v04",
    name: "Yarok Ve'Tov",
    type: "vegetarian",
    neighbourhood: "Rothschild",
    lat: 32.0637,
    lng: 34.7723,
    opening_hours: "Sun-Thu 12:00-23:00, Fri 12:00-16:00, Sat closed",
    attributes: ["vegetarian", "vegan mains", "nut-free kitchen"],
  },
  {
    id: "v05",
    name: "Ha'Bayit Shel Sabta",
    type: "home cooking",
    neighbourhood: "Ramat Gan",
    lat: 32.0821,
    lng: 34.8102,
    opening_hours: "Sun-Thu 12:00-22:30, Fri closed, Sat closed",
    attributes: ["kosher", "parking", "reservations"],
  },
  {
    id: "v06",
    name: "Pina Sheketa",
    type: "cafe-restaurant",
    neighbourhood: "Givatayim",
    lat: 32.0741,
    lng: 34.8098,
    opening_hours: "Sun-Thu 08:00-23:00, Fri 08:00-15:00, Sat 19:00-23:00",
    attributes: ["quiet", "vegetarian mains", "public transport nearby"],
  },
  {
    id: "v07",
    name: "Dag Al Ha'Yam",
    type: "seafood",
    neighbourhood: "Tel Aviv port",
    lat: 32.0977,
    lng: 34.7743,
    opening_hours: "Sun-Thu 12:00-23:30, Fri 12:00-00:00, Sat 12:00-23:30",
    attributes: ["seafood", "shellfish on the menu", "parking"],
  },
  {
    id: "v08",
    name: "Ha'Karnaf",
    type: "grill",
    neighbourhood: "Ramat Gan",
    lat: 32.0857,
    lng: 34.8121,
    opening_hours: "Sun-Thu 18:00-23:30, Fri closed, Sat closed",
    attributes: ["kosher", "meat", "parking", "loud"],
  },
  {
    id: "v09",
    name: "Lachmanina Kitchen",
    type: "bakery-restaurant",
    neighbourhood: "Florentin",
    lat: 32.0542,
    lng: 34.7671,
    opening_hours: "Sun-Thu 07:00-20:00, Fri 07:00-15:00, Sat closed",
    attributes: ["nuts in the kitchen", "outdoor seating"],
  },
  {
    id: "v10",
    name: "Basta Shel Yossi",
    type: "small plates",
    neighbourhood: "Carmel market",
    lat: 32.0685,
    lng: 34.7688,
    opening_hours: "Sun-Thu 18:00-00:30, Fri 12:00-17:00, Sat closed",
    attributes: ["small plates", "no reservations", "loud"],
  },
  {
    id: "v11",
    name: "Ha'Gina Ha'Achorit",
    type: "mediterranean",
    neighbourhood: "Neve Tzedek",
    lat: 32.0611,
    lng: 34.7607,
    opening_hours: "Sun-Thu 18:00-23:00, Fri 12:00-16:00, Sat 19:00-23:00",
    attributes: [
      "gluten-free kitchen",
      "vegetarian mains",
      "quiet",
      "reservations",
    ],
  },
  {
    id: "v12",
    name: "Tavlinim",
    type: "middle eastern",
    neighbourhood: "Jaffa",
    lat: 32.0524,
    lng: 34.7521,
    opening_hours: "Sun-Thu 12:00-23:00, Fri 12:00-00:00, Sat 12:00-23:00",
    attributes: ["vegetarian mains", "nut-free kitchen", "outdoor seating"],
  },
  {
    id: "v13",
    name: "Ha'Merkaz Ha'Yashan",
    type: "bistro",
    neighbourhood: "Dizengoff",
    lat: 32.0784,
    lng: 34.7742,
    opening_hours: "Sun-Thu 17:00-00:00, Fri 12:00-16:00, Sat 19:00-00:00",
    attributes: ["wine list", "reservations", "quiet"],
  },
  {
    id: "v14",
    name: "Beit Kafe Bat Yam",
    type: "cafe-restaurant",
    neighbourhood: "Bat Yam",
    lat: 32.0189,
    lng: 34.7488,
    opening_hours: "Sun-Thu 08:00-22:00, Fri 08:00-16:00, Sat 09:00-22:00",
    attributes: ["parking", "vegetarian mains"],
  },
  {
    id: "v15",
    name: "Ha'Namal Herzliya",
    type: "seafood",
    neighbourhood: "Herzliya Pituach",
    lat: 32.1631,
    lng: 34.7998,
    opening_hours: "Sun-Thu 12:00-23:30, Fri 12:00-00:00, Sat 12:00-23:30",
    attributes: ["seafood", "shellfish on the menu", "parking", "large room"],
  },
  {
    id: "v16",
    name: "Shulchan Aruch",
    type: "grill",
    neighbourhood: "Givatayim",
    lat: 32.0698,
    lng: 34.8143,
    opening_hours: "Sun-Thu 12:00-23:00, Fri closed, Sat closed",
    attributes: ["kosher", "meat", "reservations", "public transport nearby"],
  },
  {
    id: "v17",
    name: "Ha'Chatzer",
    type: "mediterranean",
    neighbourhood: "Ramat Gan",
    lat: 32.0801,
    lng: 34.8188,
    opening_hours: "Sun-Thu 18:00-23:30, Fri 12:00-15:00, Sat closed",
    attributes: [
      "kosher",
      "vegetarian mains",
      "gluten-free kitchen",
      "parking",
      "quiet",
    ],
  },
  {
    id: "v18",
    name: "Cafe Levinsky 41",
    type: "cafe-restaurant",
    neighbourhood: "Levinsky",
    lat: 32.0589,
    lng: 34.7738,
    opening_hours: "Sun-Thu 08:00-19:00, Fri 08:00-15:00, Sat closed",
    attributes: ["small room", "nuts in the kitchen"],
  },
  {
    id: "v19",
    name: "Ha'Pina Ha'Yeruka",
    type: "vegetarian",
    neighbourhood: "Florentin",
    lat: 32.0567,
    lng: 34.7702,
    opening_hours: "Sun-Thu 18:00-23:30, Fri 12:00-16:00, Sat 19:00-23:00",
    attributes: [
      "vegetarian",
      "vegan mains",
      "gluten-free kitchen",
      "nut-free kitchen",
      "outdoor seating",
    ],
  },
  {
    id: "v20",
    name: "Mizrach Ha'Ir",
    type: "middle eastern",
    neighbourhood: "Ramat Gan",
    lat: 32.0878,
    lng: 34.8043,
    opening_hours: "Sun-Thu 11:00-22:00, Fri 11:00-15:00, Sat closed",
    attributes: ["kosher", "loud", "no reservations"],
  },
  {
    id: "v21",
    name: "Ha'Shulchan Ha'Aroch",
    type: "bistro",
    neighbourhood: "Neve Tzedek",
    lat: 32.0641,
    lng: 34.7658,
    opening_hours: "Sun-Thu 18:30-00:00, Fri closed, Sat 19:00-00:00",
    attributes: ["wine list", "reservations", "small room", "quiet"],
  },
  {
    id: "v22",
    name: "Ha'Terasa",
    type: "mediterranean",
    neighbourhood: "Givatayim",
    lat: 32.0712,
    lng: 34.8087,
    opening_hours: "Sun-Thu 17:00-23:00, Fri 12:00-16:00, Sat 19:00-23:00",
    attributes: [
      "outdoor seating",
      "vegetarian mains",
      "quiet",
      "public transport nearby",
    ],
  },
  {
    id: "v23",
    name: "Bar Ha'Tzafon",
    type: "bar-restaurant",
    neighbourhood: "North Tel Aviv",
    lat: 32.0921,
    lng: 34.7817,
    opening_hours: "Sun-Thu 19:00-02:00, Fri 19:00-03:00, Sat 19:00-02:00",
    attributes: ["loud", "standing room", "no reservations"],
  },
  {
    id: "v24",
    name: "Ha'Mizvada",
    type: "bistro",
    neighbourhood: "Jaffa",
    lat: 32.0498,
    lng: 34.7549,
    opening_hours: "Sun-Thu 18:00-23:30, Fri 12:00-16:00, Sat 19:00-23:30",
    attributes: [
      "gluten-free kitchen",
      "nut-free kitchen",
      "vegetarian mains",
      "reservations",
      "outdoor seating",
    ],
  },
];

/**
 * Straight-line distance in km. This is the burden model the spec commits to —
 * a detour factor over a straight line, not a Routes API travel time (§5.4).
 */
function straightLineKm(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)) * 10) / 10;
}

/**
 * The worst-case run: six participants, 24 candidates, cycle 3 with a rejection
 * history attached. Deterministic — the same payload every time, so two
 * measurements are comparable.
 */
export function buildWorstCasePayload(): MatchPayload {
  const candidates: Candidate[] = RAW_CANDIDATES.map((c) => ({
    ...c,
    distances_km: Object.fromEntries(
      PARTICIPANTS.map((p) => [
        p.id,
        straightLineKm(p.home_lat, p.home_lng, c.lat, c.lng),
      ])
    ),
  }));

  return {
    occasion:
      "Catching up after the summer — nothing formal, a weekday evening",
    cycle: 3,
    rejection_history: [
      {
        participant_id: "p4",
        reason:
          "That is a 40 minute walk for me and I do not drive. Anywhere I can reach on foot from Neve Tzedek would work better.",
      },
      {
        participant_id: "p3",
        reason:
          "It was far too loud last time, we could not hear each other. Somewhere quieter please.",
      },
    ],
    participants: PARTICIPANTS,
    candidates,
  };
}
