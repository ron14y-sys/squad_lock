-- #249: the price a diner is expected to pay, as Google reports it.
-- Both columns are nullable and have no default: existing rows simply have no
-- price until the details cache refetches them, and old proposals show none.
ALTER TABLE "match_options" ADD COLUMN "venuePrice" JSONB;
ALTER TABLE "place_details_cache" ADD COLUMN "price" JSONB;
