# Decisions

## What did the spec not tell you?

- Response shape: one object per person, each with a list of weeks `{weekStart, allocatedHours, capacityHours}`, plus the list of weeks at the top. The grid can render it row by row.
  - I considered a columnar shape. It's smaller, but harder to read, and with gzip the size difference is small (456 KB → 27 KB for 500 people × 13 weeks).
- Weeks are ISO weeks (Monday to Sunday), and the requested range is extended to whole weeks, since the grid is weekly.
  - Max 13 weeks per request (a quarter). Longer ranges return 400 `range_too_large`.
- Only Monday to Friday count as allocated time. Ana's 8 h/day assignment runs Monday to Sunday; counting weekdays gives her 40 h capacity, counting every day would give 56 h.
  - Per-person working days would be better, but there's no place for them in the schema.
- Capacity is `weekly_hours`, the same for every week. There's no capacity history, so changing someone's hours also changes past weeks.
- Saving is pessimistic: the grid updates after the server confirms.
  - The PATCH is a single-row update and takes a few ms, so an optimistic update wouldn't feel much faster.
  - Optimistic would also mean handling rollbacks, out-of-order saves, a background refetch overwriting the value, and the same person cached in several ranges and searches.
  - After the save I update the person in every cached grid (`setQueriesData`) and refetch in the background. Allocation doesn't depend on `weekly_hours`, so only that person's capacity changes.
  - If the save fails, the grid keeps the old value and the editor stays open with what was typed and a Retry button.
  - I'd look at optimistic updates again if saves became slow (bad network, batch edits).
- Last write wins. There's no version or `updated_at` column to detect conflicts.
- No pagination: the API returns everyone in one response.
  - With 500 people the response time was fine. EXPLAIN showed the cost was in the query, not the amount of data.
  - In a test with 3,000 people and 2 years of assignments, two query fixes took it from 800–1,050 ms to ~190 ms without search, and from 300–500 ms to 15–45 ms with search.
  - Gzip keeps the payload small, and row virtualization renders ~30 rows instead of 3,000.
  - With rosters much larger than that, I'd load people in pages as you scroll.
- Name search runs on the server: case- and accent-insensitive, every word has to match somewhere in the name, best matches first, 300 ms debounce.
  - It's a filter on the capacity query, so it works with the date range, needs one request, and the cache update after a save also applies to it.
  - I didn't use a Postgres extension because that would mean changing the schema. Because of that there's no typo tolerance, the accent map is hand-written, and it scans the whole `people` table.
  - If I could change the schema I'd use `pg_trgm` and `unaccent` with a GIN index.
- Smaller things:
  - The previous and next weeks are prefetched, so moving one week is instant (~27 KB each).
  - When the browser cancels a request, the query is cancelled in Postgres too, and it's not logged as a 500.

## What did you notice that looked wrong?

- The name column resizes to the longest visible name, so the columns move when you search or scroll. A fixed width with truncation would fix it; I didn't get to it.
- Eli Nakamura has 0 h capacity and 20 h allocated. That's in the seed, and the grid shows it as over capacity.
- When the search changes, the old results stay on screen for about a second until the new ones load. I left it.
- Search ties are sorted by name, so "Sørensen" (surname) comes before "Søren" (first name).
- I compared the numbers with a day-by-day brute-force query: 19,500 person-weeks over four ranges, all matching.

## What did the AI get wrong that you caught?

- The capacity query was fast with the 500 seeded people but didn't scale. The search part joined every name with every name, and the way the weeks were generated made Postgres estimate ~1,000 rows instead of 13, so it JIT-compiled the query (~250 of ~280 ms). The tests didn't catch either; I found them by asking for EXPLAIN ANALYZE and a run with 3,000 people, and had both fixed.

## What would you do differently with a week?

- Fix the name column width.
- Store capacity history and per-person working days, so editing hours doesn't change the past.
- Add a version column so concurrent edits don't silently overwrite each other.
- Typo-tolerant search with `pg_trgm`, if the schema could change.
- Run the database tests and a Playwright test for editing and a failed save in CI.
- Load people in pages for much larger rosters.
