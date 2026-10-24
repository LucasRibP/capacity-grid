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

## Backend: compressed responses (#14)

- `klauspost/compress/gzhttp` wraps the whole handler in `newHandler`. Measured on :8081 against the shared database,
  `GET /api/capacity?from=2025-12-29&to=2026-03-29` (500 people x 13 weeks): **455,863 bytes plain, 26,579 bytes with
  `Accept-Encoding: gzip`** (~17x smaller). Same numbers through the Vite proxy on :3001, which passes the encoding
  through untouched. A few thousand people scale that to ~2-3 MB plain, ~150 KB gzipped.
- **zstd comes for free.** gzhttp v1.20 also negotiates zstd, and Chrome asks for it: the browser got the same response
  in 24,358 bytes with `Content-Encoding: zstd`. Left on: every current browser decodes it and gzip remains the
  fallback for everything else.
- Bodies under 1 KB (every error response) are sent uncompressed, the library default; `Vary: Accept-Encoding` is set
  on every response, so a cache never hands a compressed body to a client that did not ask for it. Errors were
  checked with and without the header: valid `{code, message}` JSON either way.

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
  names. It grows linearly: expect tens of ms at a few thousand people. If it ever matters, the cheap win is to compute
  `position()` once per name/term pair (it runs twice today: match and rank); beyond that it needs the `pg_trgm`
  route described under "Search".
- **Testing the SQL:** `TestCapacitySearchAgainstSeed` is opt-in (`CAPACITY_TEST_DATABASE_URL`). The shared
  database is not published on the host, so build the test binary for Linux (`CGO_ENABLED=0 GOOS=linux go test -c`),
  `docker cp` it into a throwaway `postgres:17` container on `capacity-grid-assignment_default` and run it there.
  (A bind mount from the macOS temp dir did not work under Colima.)
- The shared stack on :8080 still runs a pre-#12 image (`not_implemented`), so comparisons were made against a
  throwaway build of `origin/main` on :8083.

## Row virtualization (#8)

- Rows were already virtualized since #5 (`@tanstack/react-virtual`, 44 px rows, overscan 10). What #8 still needed
  was the editor: scrolling its row out of view unmounted it and dropped a save in flight, its error and the
  typed value.
- **A row whose editor is open stays mounted.** `WeeklyHoursEditor` reports open/close; `GridTable` adds those
  rows to the virtualizer's range (`rangeExtractor`) and puts a spacer `<tr>` in each gap. The editor cannot close
  mid-save and only closes on success or cancel, so "open" covers pending and failed. Focus inside the popover
  survives too. Chosen over lifting editor and mutation state out of the row: that meant changing
  `useUpdateWeeklyHours` (shared with the #19 work) or tracking one mutation per person by hand.
- Measured with 3,000 people × 13 weeks (`src/test/largeGrid.ts`, and `fetch` patched in the embedded browser):

  | | rows in DOM | cells | jsdom render |
  |---|---|---|---|
  | All rows (virtualizer forced to render every index) | 3,000 | 39,000 | ~27 s |
  | Virtualized, jsdom (800 px box) | 29 | 377 | ~0.4 s |
  | Virtualized, browser (590 px scroller) | 24 | 312 | |
  | Browser, scrolled to row 2,000 with an editor open on row 1 | 35 (34 + the editing row) | | |

  With the real API (500 people, 3 weeks): 24 rows. Sticky header and name column hold at row 2,000 and with a
  horizontal scroll.
- Left as is: a focused trigger (not an open editor) still loses focus to `body` if a mouse scroll takes its row
  out of view; Tab and keyboard scrolling keep it in view, so only the mouse case is affected. Also, the id of a
  person who leaves the grid while their editor is open (e.g. filtered out by search) stays in the editing set;
  it maps to no row, so it costs nothing until that person comes back, where their row stays mounted until the
  editor is opened and closed.
- The shared stack on :8080 still serves the pre-#12 stub, so the browser check used `api/` from `main` on :8081.

## Frontend: name search (#19)

- **The input is never debounced, only the query.** `PeopleSearch` keeps its own text and writes the trimmed value to
  `?q=` after 300 ms of quiet; clearing (the ✕, Escape, or "Clear search" in the empty grid) applies at once. When
  the URL changes without typing (back button, the empty state's button) the box follows it.
- **`q` is written with `replaceState`, the range with `pushState`.** One history entry per pause in typing would
  bury the back button; a search reads as a filter on the current page. Range navigation keeps whatever `q` is set.
  Both params now share one URL store (`lib/locationSearch.ts`).
- **A blank search is left out of the query params**, so the unfiltered grid keeps its single `['/capacity',
  {from, to}]` cache entry. The post-save patch already matched every `['/capacity', …]` key, searched ones included;
  a test now proves it through the UI.
- **"No one matches “q”" is a different state from "No people to plan yet"**, with a button to clear the search.
- The MSW handler filters by `q` roughly like the contract (folds case and accents with NFD plus a few letters NFD
  leaves alone, every term a substring, word-start matches first). Søren Hagen was added to the mock people to match
  the issue's example.
- Browser check was partial: the embedded browser blocks MSW's service worker, and the shared stack on :8080
  answered `501 not_implemented` for `/api/capacity` (an image older than `main`). The network log still showed one
  `GET /api/capacity?…&q=soren+hag` after typing nine characters, and `q` in the URL. Rows against the real search
  are to be checked once #18 lands.

## Backend: cancel the capacity query when the client goes away (#15)

- **The ctx already reached every pgx call** in `GetCapacity` and `UpdatePerson` (no `context.Background()` outside
  `run`). That alone did not stop the work in Postgres: pgx's default reaction to a cancelled ctx is to set a past
  deadline on the socket and drop the connection, and Postgres keeps running the statement until it next writes to
  the client. The pool now uses `pgconn.CancelRequestContextWatcherHandler`, which sends a cancel request (the
  deadline stays as a 1 s fallback). Measured on :8081: requests aborted with `curl --max-time 0.01` show
  `ERROR: canceling statement due to user request` in the db log, one per request; a build of `origin/main` showed none.
- **Client gone = the request ctx is done**, not "the error is `context.Canceled`". pgx can surface a cancellation as
  a closed-connection error that wraps neither `Canceled` nor `DeadlineExceeded`; the request ctx is the reliable
  signal. Cost: a genuine fault that coincides with an abort is not logged. Accepted: nobody would see that response,
  and the next request hits the same fault. There is no server-side request timeout today, so `DeadlineExceeded`
  only comes from the client side through this same path.
- **Status: 499 with no body, nothing logged.** The client cannot read anything we write, so the only reader is
  whatever sits in front (access log, proxy metrics). nginx's 499 "client closed request" tells those readers it was
  not a server failure, where an implicit 200 would look like a success and a 500 like a fault. It is not in the
  contract on purpose: no client ever receives it.
- Before (origin/main build, 20 aborted requests): 20 `handler error: read capacity: context canceled` lines.
  After: no log lines.

## Query plan and scale (#4)

`golangci-lint run ./...` and `golangci-lint fmt --diff` are clean on `main`; nothing to fix.

How it was measured: the real `capacityQuery` text, `PREPARE`d with the parameters Go sends (`$3` = the terms array,
`$4`/`$5` = `foldFrom`/`foldTo`), then `EXPLAIN (ANALYZE, BUFFERS) EXECUTE` for 2025-12-29 to 2026-03-29 (13 weeks).
"Scale" is a throwaway `postgres:17` container, deleted afterwards: the seed, plus its first five months copied 22
weeks earlier (history 2024-12-30 to 2027-01-03, two years), plus five copies of every person with their assignments
(3,000 people, 973k assignment rows, 93 MB). The laptop was shared with other agents, so times vary by ±30%; the
shapes and ratios are what to read. The shared database was only read.

### What the plan shows today (seed: 500 people, 126k rows)

| `q` | Execution (custom plan) | of which JIT | without JIT |
|---|---|---|---|
| none | 265 to 305 ms | 225 to 260 ms | 35 to 41 ms |
| `ana` | 13 ms | none | 13 ms |
| `soren hag` | 10 ms | none | 10 ms |

- **JIT is most of the cost.** `generate_series(date, date, interval)` has no row estimate support, so `weeks` is
  planned as 1,000 rows instead of 13. The people × weeks join is then estimated at 500,000 rows and the plan at
  ~1.1M cost, above `jit_optimize_above_cost` (500k): Postgres compiles 64 functions with inlining and optimisation
  (~250 ms) to run a query whose work takes 35 ms.
- **The plan cache spreads it to searches.** pgx prepares the statement per connection. After five executions
  Postgres compares the generic plan (527k estimated cost) with the custom ones (1.1M) and keeps the generic one,
  which also misestimates and also JITs. From then on every request on that connection pays ~220 ms, searches
  included: in psql, six runs without `q` and then `soren hag` took 225 ms instead of 10 ms; through the API (:8082
  on `main`), `q=soren hag` takes 210 to 230 ms after a few unfiltered requests and 12 ms on a fresh container.
- Without JIT (no `q`): `folded` + `matched` 9 ms, `allocated` 16 ms (13 index scans on
  `assignments (start_date, end_date)`, one per week, 33,630 assignment-week pairs, a `HashAggregate` to 2,240
  groups), the people × weeks nested loop, hash left join and final sort ~8 ms. Everything is shared-buffer hits.
- **`matched` does work when there is no `q`.** It is a nested loop over `folded` against itself: for each of the
  500 names it rescans the whole materialised `folded` CTE looking for `src = 'term'` rows (250,000 rows filtered to
  find none). Harmless at 500 people, quadratic in the roster.

### At production scale (3,000 people, two years)

| Variant | no `q` | `ana` | `soren hag` |
|---|---|---|---|
| query on `main` | 800 to 1,050 ms (450 without JIT) | 360 to 500 ms | 300 ms |
| integer week series (estimate exact) | 530 to 580 ms | 320 to 350 ms | |
| + terms in their own `MATERIALIZED` CTE | 190 to 330 ms (135 to 145 without JIT) | 33 to 46 ms | 15 ms |
| + first 100 people only (`LIMIT 100` in `searched`) | 20 to 27 ms | | |

Through the API on the scale database: 0.5 s per unfiltered request, 2,736,569 bytes plain and 53,451 gzipped
(synthetic names repeat six times, so real names compress worse: expect the ~150 KB estimated in #14); `q=ana` 0.42 s.

- **The bottleneck is the self-join in `matched`, then the misestimate.** At 3,000 people `matched` is 317 ms with no
  `q` (3,000 rescans of a 3,000-row CTE). Moving the terms into their own small `MATERIALIZED` CTE keeps the single
  normalisation and makes it people × terms: 11 ms. Writing the week series as
  `$1::date + 7 * i FROM generate_series(0, ($2::date - $1::date) / 7) i` gives an exact estimate (13 rows, 6,500 /
  39,000 output rows), keeps the planner on custom plans and drops the JIT compile on the seed (28 ms instead of 265).
  Both are SQL changes in `api/capacity.go`, out of scope for #4: reported, not made. Setting `jit = off` on the pool
  would also work, but fixing the estimate fixes the cause and keeps the costs honest for other plan choices.
- **Indexes: none needed for this data.** The schema's `(start_date, end_date)` btree already serves the scan: the
  isolated range scan is a 2.5 ms index-only scan, and per week it reads 15,522 rows at scale in ~2 ms. With `q`, the
  planner uses `assignments (person_id)` for the matching people. Added in the throwaway database, neither
  `(person_id, start_date, end_date)` nor a GiST index on `daterange(start_date, end_date, '[]')` (with the predicate
  rewritten to `&&` so it can be used) changed the time beyond noise; the composite one was not even chosen. The
  reason: assignments here are at most 14 days long, so the leading `start_date <= to` bound plus the `end_date`
  filter inside the index stays tight. If production has long assignments (months), `end_date >= from` stops being
  selective in a btree led by `start_date`, and the GiST range index (with the `&&` predicate) is the one to add.
  The composite index helps only if a page of people is fetched by id, where it turns each person's lookup into one
  range read.
- **The remaining cost is people × weeks, not the scan.** At scale, without JIT: expanding 135k assignments into
  201,780 assignment-week pairs and aggregating them to 13,440 groups ~100 ms; the people × weeks join (39,000 rows)
  and the final sort ~40 ms; then Go builds and encodes 2.7 MB of JSON. All of that is linear in people × weeks, which
  is why the 13-week cap matters and why the next lever is the number of people per request.
- **People pagination or windowing.** The grid virtualises rows (#8), so the browser renders only what is visible
  but still downloads and holds all of them. Limiting the query to the first 100 people of the same order took it to
  ~21 ms at scale (assignments of those people via `assignments_person_id_idx`). A keyset cursor on
  `(rank, name, id)` would keep pages stable while people are added; `rank` only exists when `q` is set, so without
  search the cursor is `(name, id)`. It needs a contract change (`limit`, `cursor`, a `nextCursor` in the response)
  and an infinite query on the web, which is why it stays deferred. Up to a few thousand people the full list stays
  acceptable once the two SQL fixes are in (~150 to 300 ms, ~150 KB gzipped).
- **Search.** With the `matched` fix, search is 15 to 45 ms at 3,000 people and linear in names; it stays a
  sequential scan of `people` (milliseconds). `pg_trgm` + `unaccent` with a GIN index on the folded name ("Search"
  above) would make it index-backed and typo-tolerant, but it needs a schema change and is not what limits latency
  at this size.
- **JSON size is not the bottleneck on the wire** thanks to gzip (17x on the seed, 50x on the synthetic data). It is
  CPU and memory on both ends: ~2.7 MB to encode in Go and parse in the browser per request at 3,000 people, which is
  another argument for paging rather than for a denser format.

## Frontend: prefetch the neighbouring weeks (#16)

- **Lives in `useCapacity`**, so the prefetched key is built by the same `capacityParams` as the grid's own query
  (blank `q` left out). The neighbour is `shiftRange(range, ±1)` passed through `normalizeRange`, the same path a
  week-button click takes through the URL; if `normalizeRange` would change it (a notice), it is skipped. A shift
  keeps the week count, so in practice that guard never fires; it is there so a future range rule cannot make the
  prefetch ask for something the UI would not.
- **When**: the current query is a success, not fetching, and not placeholder data; no `updatePerson` mutation is
  pending (`useIsMutating` on the generated mutation key); no search is waiting for its debounce.
- **Search debounce flag**: the box and the grid are siblings, so `PeopleSearch` publishes "text ahead of `?q=`"
  through a tiny external store in `useSearchParam.ts` and `CapacityGrid` reads it. Threading props through
  `App` → `RangeToolbar` → `PeopleSearch` was the alternative; the store kept the change to three files.
- **Prefetches carry their own `staleTime` (30 s)**, matching the app client, so "fetched once" does not depend on the
  client default (the test client uses 0). With staleTime 0 every settle would re-request both neighbours.
- **After a save**: `setQueriesData` on `['/capacity']` patches the prefetched entries too (test proves it), and
  `invalidateQueries` marks them stale. They are not active, so they are only refetched when the grid settles again
  and the prefetch runs, which is after the save has resolved.
- Used `queryClient.query(...).catch(noop)` instead of `prefetchQuery` (deprecated in our TanStack Query 5.104; lint
  rejects it). A failed prefetch is silent: the week then loads on click as before.
- Existing tests that counted capacity requests (`PeopleSearch`, `WeeklyHoursEditor`) now count only the range on
  screen.
- Browser check against `api/` from this branch on :8081: after load, `from=2025-12-22` and `from=2026-01-05`
  finished at ~1.0 s; "Next week" clicked at ~13 s rendered the new weeks on the next frame with no "Updating…" and no
  request for that range; only `from=2026-01-12` followed. Same with `q=ana+fer`. The save path was not exercised in
  the browser (the editor sends nothing for an unchanged value, and a real change would write to the shared
  database); it is covered in Vitest.

## End-to-end verification (#9)

Run on main at 99c8c47 (everything through #31 merged), `make up` from scratch, grid on :3000.

- **Numbers against the seed.** The API compared with a brute-force query (one row per calendar day, Mon–Fri only,
  summed per person/week) for four ranges: 2025-12-29..2026-03-29, 2026-09-28..2026-12-27, 2025-06-02..2025-08-31 and
  the year boundary 2026-12-28..2027-01-03. 19,500 person-weeks, 0 mismatches in allocated or capacity hours. Spot
  checks: Ana Ferreira 40 / 0 / 30 from 29 Dec; Eli Nakamura capacity 0 with 20 h in the week of 5 Jan (red, "20 / 0");
  Dee Okafor 45 / 40 that same week. 129 of 500 people are over capacity in at least one week of Q1 2026. The seed has
  no assignment with start after end and no hours_per_day outside 0..24.
- **Navigation.** On load the grid requests the range plus both neighbours; "next week" renders on the next frame
  with no request for that range, then prefetches the following week.
- **Search.** Typing "soren" sends one request (debounce), matches the 15 Sørensen/Søren people and goes into the URL.
  Ties are broken by name, so surnames "Sørensen" list before first names "Søren": accepted, it is the agreed order.
- **Edit.** Ingrid Sørensen 40 → 25: the row shows 25 h/wk and her 30 h weeks turn red immediately after the 200;
  the searched and unsearched cached ranges show the new value (cache patch + background refetch).
- **Failed save.** API container stopped, save 25 → 40: the grid kept 25 (pessimistic), the editor stayed open with
  the typed value, an error and a Retry button. API restarted, Retry saved 40. Out-of-range input (200) is stopped
  in the client with "Enter a number of hours from 0 to 168". No error lines in the API log; the browser console
  showed only the provoked 502.
- **Fixed during verification: the failed-save message was technical.** With the API down the editor said "Request
  failed with status 502". `ApiError` now falls back to "Couldn't reach the server. Check your connection and try
  again." when there is no response (fetch rejected) or a gateway status (502/503/504, what the Vite proxy returns
  when the API is down), and "Something went wrong on our side. Try again." for any other non-contract error. Contract
  errors keep the server's message. Aborts stay AbortErrors so TanStack Query cancellation is untouched. The same
  message shows on the grid's load error (checked with the API unreachable).
- **Not changed:** when the search text changes, the previous results stay on screen until the new ones arrive
  (~1 s here: debounce plus request). Left as is.
- **Dev-only noise:** the first capacity request on page load shows as aborted in the browser. React StrictMode mounts
  twice in development; the API logs nothing for it (#15 turns aborts into a silent 499).

## Capacity query: no JIT, no quadratic search join (#32)

Two SQL changes in `capacityQuery`, nothing else (no schema, index, config or `jit = off`):

- `weeks` is `$1::date + 7 * i FROM generate_series(0, ($2::date - $1::date) / 7) AS i`. The integer series has a
  row-estimate support function, so custom plans see 13 rows instead of 1,000 and the total cost drops from ~1.1M to
  ~12k, far below `jit_above_cost`.
- The terms get their own `terms AS MATERIALIZED` CTE (still produced by the single normalisation in `folded`), and
  `matched` joins names × terms. With no `q` that is 500 scans of an empty CTE instead of 500 scans of `folded`.

Measured on the shared seed DB (read-only), real query text, `PREPARE` + `EXPLAIN (ANALYZE, BUFFERS) EXECUTE`,
2025-12-29 to 2026-03-29 (13 weeks). The "q" row is the 8th execution on the connection, after 7 without `q`:

| | before | after |
|---|---|---|
| no `q` (custom plan) | 305 to 460 ms, JIT 64 functions, 254 to 404 ms of it | 22 to 24 ms, no JIT |
| `soren hag` after 7 executions | 202 to 280 ms, **generic** plan, JIT 68 functions | 2.4 to 2.8 ms, custom plan, no JIT |
| `pg_prepared_statements` after 8 | generic 3, custom 5 | generic 0, custom 8 |
| through the API (:8080 `main` vs :8081), no `q` | 225 to 310 ms | 20 to 38 ms |
| through the API, `q=soren hag` after 8 unfiltered | 236 to 420 ms | 3.6 to 4.7 ms |

- **After the fix the generic plan is never chosen, and that is why searches stay fast.** The generic plan still
  cannot see the parameters, so its `generate_series(0, ($2 - $1) / 7)` falls back to the default 1,000 rows and costs
  more than every custom plan; Postgres keeps planning per execution (~1 ms). Forced with
  `SET plan_cache_mode = force_generic_plan` (in the measuring session only), the generic plan still JITs (270 to 440
  ms). Nothing in the app sets that mode, but anything that does (a pooler in transaction mode with
  `force_generic_plan`, say) would bring the JIT back.
- **Tried and rejected: a fixed series bound.** `generate_series(0, 12) WHERE i <= ($2 - $1) / 7` is estimated
  identically in both plans (4 rows: default 1/3 selectivity of 13), so even a forced generic plan has no JIT. But
  then the generic plan wins after five executions and it does not narrow `allocated` to the matching people:
  `soren hag` went from 2.4 to 27 ms. It would also have to stay in sync with `maxWeeks` by hand.
  The way to make both plans exact is to send the Mondays as a `date[]` and `unnest` it (estimate = array length in
  custom plans, 10 in generic ones). That changes the Go call, not only the SQL, so it is left for later.
- **Results unchanged.** Old and new query output compared row by row for no `q`, `soren hag`, `an`, `SØREN`, `thor`,
  `петрова`, `%` and `e a` (6,500 / 13 / 1,586 / 195 / 91 / 13 / 0 / 3,588 rows, all identical). Brute force: every
  assignment expanded day by day, weekends dropped, summed per person per ISO week, 6,500 person-weeks (2,240 with
  hours) identical to the new query. The API JSON for the 13-week range is byte-identical between `main` and the
  branch. `TestCapacitySearchAgainstSeed` passes against the seed (test binary run on the Compose network).
- Not re-measured at 3,000 people: #30's throwaway-database numbers for these exact two changes stand
  (no `q` ~190 ms, with `q` 15 to 45 ms).
