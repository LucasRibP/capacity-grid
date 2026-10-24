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
