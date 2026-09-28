# Home location comes from a fixed list of areas

**Task:** [#132](https://github.com/ron14y-sys/squad_lock/issues/132), pieces 1, 2 and 3 · **Track:** C, with one small change in B3's schema
**Status:** built. The list is [`lib/geo/neighbourhoods.ts`](../../lib/geo/neighbourhoods.ts); the picker is [`LocationForm.tsx`](../../app/profile/location/LocationForm.tsx).

---

## What was wrong

`PreferenceProfile.homeLat` and `homeLng` were never written by anything. The
location screen saved a free-text neighbourhood name and no coordinates, so every
profile had `NULL` there and `originOf` refused to weigh any meeting.

## The decision: a checked-in list, not a Places search

[`onboarding-flow.md`](../onboarding-flow.md) already settled the shape: the user
picks a neighbourhood by name, no GPS, and only an area is stored. What it left
open, and what #132 named as undecided, was **where the coordinates come from**.

|       | Fixed list             | Places Text Search                                                           |
| ----- | ---------------------- | ---------------------------------------------------------------------------- |
| Cost  | none                   | one Enterprise request per signup, from the 1,000 a month the project shares |
| Reach | only the areas we list | anywhere Google knows                                                        |
| Work  | write the list once    | a server endpoint, a key, error handling                                     |

The list wins on cost and on being able to build it without touching Track B.
What it gives up is coverage: a user whose area is not listed cannot finish the
screen. That is the price, and adding an area is one entry in one file.

**Reversible.** The picker only needs `{ label, centre }` from whatever backs it.
Swapping the source for a search later changes `neighbourhoods.ts` and the
`<select>`, not the API, the schema or the database.

## What was built

1. **The list.** Tel Aviv by neighbourhood (seven), everywhere else one point per
   city (twenty-four, including the three the team lives in). Coordinates are
   hand-entered approximate centres, good to about a kilometre and **not checked
   against a map source**. That is enough for the distance maths and the
   per-neighbourhood search, which models "the area around X" as a radius.
2. **A home cannot be left empty.** The form's save button is disabled until an
   area is picked, and `preferenceProfileInputSchema` rejects a
   `homeNeighbourhood` sent without `home`. Every other field stays an independent
   patch, so the preference game's partial saves are unaffected.
3. **Whoever is missing one is told.** [`MissingHomeBanner`](../../app/_components/MissingHomeBanner.tsx)
   on the groups screens links to the location screen. It says nothing when signed
   out, on a network error, or while loading.

## Not done, on purpose

- **The `stuck` screen does not yet say "someone in the group has no home".**
  #132 asks for it; it needs the meeting detail to know whose origin is missing,
  which is a change to what `getMeetingDetail` returns. Left for its own change.
- **Existing profiles are not migrated.** Free text from before the picker matches
  nothing and shows as "not picked", so those users see the banner and pick again.
  Their coordinates were never saved, so nothing is lost.
- **The list is not exhaustive.** Cities not on it, and neighbourhoods inside
  cities other than Tel Aviv, are absent.
