# Worklog

Running notes on how this got built — decisions, assumptions, dead ends, and anything
left unfinished. Append as you go; a line or two per entry is right.

---

## Planning

- **Single OpenAPI contract** (`contract/openapi.yaml`) feeding oapi-codegen (Go strict server, std-http) and
  Orval (TanStack Query hooks, Zod, MSW mocks). Generated code is committed, so the fixed Dockerfiles still build
  it. MSW mocks let the frontend start before the API exists.
- **Response shape: one object per person, one object per week inside it** (`weekStart`, `allocatedHours`,
  `capacityHours`), plus a top-level `weeks` list for the header. Considered a columnar shape (parallel arrays
  aligned by index): smaller payload, but implicit index alignment is fragile and hard to read, and with gzip the
  difference is small. If columnar is what separates good from bad performance, a decision upstream was wrong.
  Contract guarantees every person carries every week, in the same order.
- **Weeks are ISO (Monday–Sunday).** The requested range is widened to whole weeks.
- **Max 13 weeks per request** (a quarter, the horizon a manager plans and reviews hours in). Larger ranges → 400.
  People pagination deferred.
- **Working days only (Mon–Fri) count toward allocation.** Seed hint: Ana's 8 h/day assignment running Mon–Sun
  equals exactly her 40 h capacity on weekdays, 56 h on calendar days. Ideally working days would be configurable
  per person; the schema has no place for that.
- **Saves are pessimistic to start**: the grid changes only after the server confirms; then the cached capacity
  for that person is patched in every loaded range and revalidated in the background. Editing `weekly_hours`
  never changes allocations, so patching is exact. With more time: optimistic save with rollback for
  responsiveness.
- **No concurrency control**: last write wins. No `updated_at`/version column and the schema is fixed.

## Backend: GET /api/capacity (#2)

- **Weekday count without a calendar table.** Within one ISO week Mon–Fri is the contiguous span
  `[week_start, week_start + 4]`, so an assignment's weekdays in that week are the length of its overlap with that
  span. Weekend days are never inside it. One query: `generate_series` weeks, assignments joined to the weeks they
  touch, summed per person/week, then `people × weeks LEFT JOIN` so everyone gets every week. Sums stay `numeric`;
  the cast to `float8` happens only on the final value.
- **Verified against a brute-force day-by-day query** (one row per calendar day, weekdays only) for the default
  range: all 1500 person-week values identical. Ana Ferreira 40 / 0 / 30, Eli Nakamura capacity 0 with 20 h.
- **Error messages**: the date-format 400 used to dump the kin-openapi regex; now `from: must be a date in
  YYYY-MM-DD format`, also for dates that match the pattern but do not exist (2026-02-30), which fail later in
  parameter binding. `from > to` → `validation_failed`; more than 13 weeks after widening → `range_too_large`.
- **Size**: 13 weeks × 500 people ≈ 455 KB of JSON, ~110 ms locally. At a few thousand people that is a few MB
  uncompressed; gzip and people pagination are the next steps (pagination is deferred by decision).

## Search

- **Server-side name search, no Postgres extension.** `GET /api/capacity` takes an optional `q`: case- and
  accent-insensitive, split on whitespace, every term must be a substring of the name, relevance (word-start matches)
  first. The frontend debounces typing by 300 ms. It is a filter on the capacity query, not a separate people
  endpoint, so search composes with the range, stays one round trip, and the post-save cache patch covers it.
- **Why no extension:** `db/schema.sql` is fixed input, and `CREATE EXTENSION` from the API at boot would be a schema
  change by the back door. Plain SQL (`lower` + `translate`/`replace` for accents + `position`) stays inside the rules.
- **Trade-offs we accept:**
  - No typo tolerance: "sorne" does not find Søren. Substring, word order and accents are handled.
  - The accent map is hand-written: it covers the letters in the seed and common Latin ones; a new alphabet needs
    new entries. Relevance is crude (word-start matches, then name).
  - No index can serve it, so it is a sequential scan of `people`. Fine for a few thousand names (milliseconds);
    it grows linearly with the roster.
  - Positive side: deterministic and easy to explain, no new dependency, nothing to migrate.
- **If the schema could change**, the search would run fully in the database with typo tolerance: enable `pg_trgm`
  and `unaccent`, add an IMMUTABLE `unaccent` wrapper, a GIN trigram index on the normalised name (expression index
  or generated column), match with `word_similarity`/`%` and order by similarity. Typo-tolerant, index-backed, and
  the hand-written accent map goes away.
