/**
 * The fixed list a user picks their home area from (#132, piece 1).
 *
 * Why a list and not a search: `docs/onboarding-flow.md` rules out device
 * location on purpose, and turning a typed name into coordinates through
 * Places would spend one of the project's 1,000 monthly Enterprise
 * requests per signup (spec §6.3). A checked-in table costs nothing and
 * is what `PreferenceProfile.homeLat/homeLng` were always meant to hold:
 * a centre point at neighbourhood granularity, never a street address
 * (spec §5.4).
 *
 * Coordinates are hand-entered, approximate centres (about a kilometre).
 * That is enough for the distance maths and the per-neighbourhood search
 * (spec §5.4 models "the area around X" as a radius around the centre),
 * but they have not been checked against a map source — verify before
 * relying on them for anything finer. To add an area, add one entry;
 * nothing else needs to change.
 */

import type { LatLng } from "@/lib/types";

export type Neighbourhood = {
  /** Stable key; never shown, never stored. */
  id: string;
  /** What the user sees and what `homeNeighbourhood` stores. */
  label: string;
  /** Heading it sits under in the picker. */
  group: string;
  centre: LatLng;
};

const TEL_AVIV = "תל אביב";
const CITIES = "ערים";

const at = (lat: number, lng: number): LatLng => ({ lat, lng });

export const NEIGHBOURHOODS: readonly Neighbourhood[] = [
  // Tel Aviv, by neighbourhood — the one city large enough that a single
  // point would make two friends "in the same place" who are a bus ride apart.
  {
    id: "ta-centre",
    label: "מרכז תל אביב",
    group: TEL_AVIV,
    centre: at(32.0809, 34.7806),
  },
  {
    id: "ta-florentin",
    label: "פלורנטין, תל אביב",
    group: TEL_AVIV,
    centre: at(32.0563, 34.769),
  },
  {
    id: "ta-neve-tzedek",
    label: "נווה צדק, תל אביב",
    group: TEL_AVIV,
    centre: at(32.0616, 34.7663),
  },
  {
    id: "ta-kerem",
    label: "כרם התימנים, תל אביב",
    group: TEL_AVIV,
    centre: at(32.068, 34.768),
  },
  {
    id: "ta-jaffa",
    label: "יפו, תל אביב",
    group: TEL_AVIV,
    centre: at(32.0543, 34.7519),
  },
  {
    id: "ta-old-north",
    label: "הצפון הישן, תל אביב",
    group: TEL_AVIV,
    centre: at(32.09, 34.78),
  },
  {
    id: "ta-ramat-aviv",
    label: "רמת אביב, תל אביב",
    group: TEL_AVIV,
    centre: at(32.113, 34.789),
  },

  // Everywhere else, one point per city.
  { id: "holon", label: "חולון", group: CITIES, centre: at(32.0158, 34.7874) },
  {
    id: "ramat-gan",
    label: "רמת גן",
    group: CITIES,
    centre: at(32.0684, 34.8248),
  },
  { id: "ashdod", label: "אשדוד", group: CITIES, centre: at(31.8044, 34.6553) },
  {
    id: "rishon",
    label: "ראשון לציון",
    group: CITIES,
    centre: at(31.973, 34.7925),
  },
  {
    id: "givatayim",
    label: "גבעתיים",
    group: CITIES,
    centre: at(32.0722, 34.8121),
  },
  {
    id: "bnei-brak",
    label: "בני ברק",
    group: CITIES,
    centre: at(32.0807, 34.8338),
  },
  { id: "bat-yam", label: "בת ים", group: CITIES, centre: at(32.023, 34.7503) },
  {
    id: "petah-tikva",
    label: "פתח תקווה",
    group: CITIES,
    centre: at(32.084, 34.8878),
  },
  {
    id: "rehovot",
    label: "רחובות",
    group: CITIES,
    centre: at(31.8928, 34.8113),
  },
  {
    id: "herzliya",
    label: "הרצליה",
    group: CITIES,
    centre: at(32.1663, 34.8436),
  },
  {
    id: "ramat-hasharon",
    label: "רמת השרון",
    group: CITIES,
    centre: at(32.1461, 34.8394),
  },
  {
    id: "raanana",
    label: "רעננה",
    group: CITIES,
    centre: at(32.1848, 34.8713),
  },
  {
    id: "kfar-saba",
    label: "כפר סבא",
    group: CITIES,
    centre: at(32.175, 34.9066),
  },
  {
    id: "hod-hasharon",
    label: "הוד השרון",
    group: CITIES,
    centre: at(32.15, 34.889),
  },
  {
    id: "rosh-haayin",
    label: "ראש העין",
    group: CITIES,
    centre: at(32.0956, 34.9566),
  },
  {
    id: "netanya",
    label: "נתניה",
    group: CITIES,
    centre: at(32.3215, 34.8532),
  },
  { id: "yavne", label: "יבנה", group: CITIES, centre: at(31.8781, 34.7396) },
  { id: "lod", label: "לוד", group: CITIES, centre: at(31.9515, 34.8954) },
  { id: "ramla", label: "רמלה", group: CITIES, centre: at(31.9297, 34.8667) },
  {
    id: "modiin",
    label: "מודיעין",
    group: CITIES,
    centre: at(31.8969, 35.0104),
  },
  {
    id: "ashkelon",
    label: "אשקלון",
    group: CITIES,
    centre: at(31.6688, 34.5743),
  },
  {
    id: "beer-sheva",
    label: "באר שבע",
    group: CITIES,
    centre: at(31.253, 34.7915),
  },
  {
    id: "jerusalem",
    label: "ירושלים",
    group: CITIES,
    centre: at(31.7683, 35.2137),
  },
  { id: "haifa", label: "חיפה", group: CITIES, centre: at(32.794, 34.9896) },
];

/** Headings in the order the picker shows them. */
export const NEIGHBOURHOOD_GROUPS: readonly string[] = [TEL_AVIV, CITIES];

/** Looks a stored `homeNeighbourhood` label back up; undefined for the free
 * text that older profiles hold — those have to be re-picked. */
export function findNeighbourhoodByLabel(
  label: string | null | undefined
): Neighbourhood | undefined {
  if (!label) return undefined;
  return NEIGHBOURHOODS.find((n) => n.label === label.trim());
}

export function findNeighbourhoodById(id: string): Neighbourhood | undefined {
  return NEIGHBOURHOODS.find((n) => n.id === id);
}
