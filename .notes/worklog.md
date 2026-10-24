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

## Backend: PATCH /api/people/{id} (#3)

- **Last write wins.** `UPDATE ... RETURNING` with no version check: the fixed schema has no `updated_at` or
  version column. Two managers editing the same person at once silently overwrite each other; with a schema change,
  an `If-Match` on a version column would turn that into a 409.
- Ids above the 32-bit `serial` range return 404 (they cannot exist) rather than a 500 from parameter encoding.
- Verified on the shared database: PATCH Eli Nakamura to 37.5 → `GET /api/capacity` (the #2 branch) showed 37.5 in
  every week with allocations unchanged; then restored to 0.

## Frontend

- **Grid cells are fill bars (#5)**, chosen by the human from three GitHub-style options: each person-week is a bar
  filled to allocated / capacity, labelled "allocated / capacity". Over-allocation is red, striped, has a warning
  icon and reads "over by N h" to screen readers, so it never depends on color. Any allocation on zero capacity
  is over (Eli Nakamura); 0 / 0 is neutral. No division happens when capacity is 0.
- **UI kit: shadcn/ui on Tailwind 4**, at the human's request. The compose `web` service runs `npm install` on
  start, so new dependencies need no change to the run environment. Gotcha: `cn()` merges Tailwind classes, so a
  custom utility named `bg-*` is dropped next to a `bg-<color>` class. The stripes utility is called `stripes`.
- **Rows are virtualized** (`@tanstack/react-virtual`): production has a few thousand people and pagination is
  deferred. jsdom has no layout, so `src/test/setup.ts` gives elements an 800 px client box. Without it the
  virtualizer renders no rows in tests.
- **Late responses**: the query is keyed by range with `keepPreviousData`, so an old range's response lands in
  its own cache entry and never replaces the grid on screen; leaving a range aborts its request through the
  signal the generated client forwards. A test makes the old range answer last and checks the grid.
- **Tests run in `America/Sao_Paulo`** (`vite.config.ts` `test.env`), where parsing `YYYY-MM-DD` with `new Date`
  shows the previous day, so that class of bug fails in CI.
- The embedded browser in the desktop app blocks service workers, so MSW can't run there. To check against mocks,
  `window.fetch` was patched from the console with `buildCapacityGrid` from `src/api/mocks/capacity.ts`.
- **Range in the URL without a router (#6)**: `?from=&to=` read with `useSyncExternalStore`, written with
  `pushState`, so the back button steps through ranges. A hand-edited link that is invalid, reversed or longer than
  13 weeks is fixed before any request (default range, swapped, or clamped to the Sunday of the 13th ISO week) and
  a notice says so. The URL keeps what was asked for until the next navigation, so the notice doesn't flash away.
- **Picker**: shadcn Calendar (react-day-picker), weeks from Monday, `resetOnSelect` so the first click starts a
  new range. Once a start is picked, days more than 13 ISO weeks away are disabled. Its local `Date`s are converted
  through local calendar fields (`toLocalDate` / `fromLocalDate`), never through UTC.
- Checked at production size by patching `fetch` with 3,000 people × 13 weeks: 25 rows in the DOM, sticky header
  and name column hold at row 1,365.
- **Weekly hours are edited in a popover (#7)**, opened from the "h/wk" next to each name, not by swapping the
  cell for an input: a failed save must show the server's message and a retry, which does not fit a 44 px
  virtualized row. Enter saves, Escape cancels; the popover cannot close while a save is in flight, so its outcome
  is never hidden. On success the server's `weeklyHours` is written into every cached `['/capacity', …]` query and
  they are invalidated in the background (`useUpdateWeeklyHours`). The input is text with `inputMode="decimal"`,
  so the typed value is kept as typed on a failed save; a comma is accepted as the decimal separator.
- Left as is: scrolling a row far enough out of view unmounts its editor (virtualization), dropping an unsaved
  draft. A save already sent still lands in the cache.
- The browser mock for PATCH keeps the change (so the background refetch agrees) and fails on 13 h, to try the
  failed-save path. Checked in the embedded browser with `window.fetch` patched from the console, as above.

- #7 checked against the real API (`api/` from this branch on :8082): saving Fatima Al-Rashid at 30 h turned her
  30 / 20 week from red to 30 / 30 without a reload; restored to 20 afterwards. The PATCH mock's codes and messages
  were aligned with the API's (bounds, missing value, unknown id, internal).


## Error codes and messages (review follow-up to #12 and #13)

- **`Error.code` is an enum in the contract:** `validation_failed`, `range_too_large`, `not_found`, `internal`.
  Those are the only codes the API emits (`not_implemented` went away with the stubs). Go gets typed constants
  (`oapi.ValidationFailed`, ...) so a typo no longer compiles; the web gets the `ErrorCode` union, and `ApiError.code`
  is `ErrorCode | 'unknown'` (`unknown` when the body is not a contract error, e.g. a proxy page).
- **One message style:** a short line, lowercase start, no trailing period, safe to show a manager, and
  `field: reason` whenever a field is to blame (`weeklyHours: number must be at most 168`, `id: must be a positive
  whole number`). Errors about the body as a whole use `body` as the field: missing (`body: value is required but
  missing`), not JSON (`body: must be valid JSON`, was `failed to decode request body`), wrong Content-Type, unknown
  property. Missing body properties say `weeklyHours: value is required but missing`, the same words kin-openapi uses
  for a missing parameter. Messages without one field keep plain wording: the 13-week limit, `no person with id 9`,
  `something went wrong, try again` (500), and the router's 404s.

## Backend: name search in GET /api/capacity (#18)

- **One normalisation for both sides.** Names and terms are folded by the same SQL expression, applied once to a
  `UNION ALL` of both (`folded` CTE), rather than written twice and left to drift. It runs `normalize(…, NFC)` first
  (built in since PG 13, not an extension), so a decomposed "ø" typed on some keyboards still matches.
- **Fold map as parameters.** `translate()`'s from/to strings are Go constants passed as `$4`/`$5`, so a unit test
  checks they stay aligned letter by letter (one missing letter silently shifts every fold after it). Coverage: every
  non-ASCII Latin letter in the seed (incl. Vietnamese ễ ị ơ ư, Croatian/Polish ć č ś š), common Latin ones and
  Greek tonos/final sigma. Cyrillic, Hebrew, Arabic, CJK and Hangul are only lowercased: "петрова" finds Нина Петрова,
  "petrova" does not (no transliteration).
- **Word start = name start or after a space**, as the issue says. Hyphens and apostrophes are not boundaries, so
  "woo" matches "Hyun-woo" but does not rank as a word start.
- **Terms split in Go** (`strings.Fields`) and sent as a never-nil array: pgx sends a nil slice as NULL, and
  `cardinality(NULL) = 0` is not true, which would have turned a blank `q` into "nobody".
- The allocation scan is restricted to the matching people, so a search reads only their assignments
  (`assignments_person_id_idx`). Without `q` the response is byte-identical to `main` (checked on three ranges).
- **Cost:** EXPLAIN ANALYZE of `q=soren hag` on the default range: 13 ms, ~11 ms of it folding and matching 500
  names. It grows linearly: expect tens of ms at a few thousand people. If it ever matters, the next step within the
  rules is to fold names once per request in a materialised CTE before the term cross join (already the case) and
  cut the duplicated `position()` call; beyond that it needs the `pg_trgm` route described under "Search".
- **Testing the SQL:** `TestCapacitySearchAgainstSeed` is opt-in (`CAPACITY_TEST_DATABASE_URL`). The shared
  database is not published on the host, so build the test binary for Linux (`CGO_ENABLED=0 GOOS=linux go test -c`),
  `docker cp` it into a throwaway `postgres:17` container on `capacity-grid-assignment_default` and run it there.
  (A bind mount from the macOS temp dir did not work under Colima.)
- The shared stack on :8080 still runs a pre-#12 image (`not_implemented`), so comparisons were made against a
  throwaway build of `origin/main` on :8083.
