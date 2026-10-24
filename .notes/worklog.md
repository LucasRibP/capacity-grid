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
- **Range in the URL without a router (#6)**: `?from=&to=` read with `useSyncExternalStore`, written with
  `pushState`, so the back button steps through ranges. A hand-edited link that is invalid, reversed or longer than
  13 weeks is fixed before any request (default range, swapped, or clamped to the Sunday of the 13th ISO week) and
  a notice says so. The URL keeps what was asked for until the next navigation, so the notice doesn't flash away.
- **Picker**: shadcn Calendar (react-day-picker), weeks from Monday, `resetOnSelect` so the first click starts a
  new range. Once a start is picked, days more than 13 ISO weeks away are disabled. Its local `Date`s are converted
  through local calendar fields (`toLocalDate` / `fromLocalDate`), never through UTC.
- Checked at production size by patching `fetch` with 3,000 people × 13 weeks: 25 rows in the DOM, sticky header
  and name column hold at row 1,365.
