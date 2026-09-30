-- #165: searches now return bars and cafés as well as restaurants, and carry
-- each place's type (#166). Rows cached before that hold restaurants only,
-- with no type, and would be served for up to 30 days. The table is only a
-- cache of Google's answers; the next search in each neighbourhood refills it.
DELETE FROM "place_search_cache";
