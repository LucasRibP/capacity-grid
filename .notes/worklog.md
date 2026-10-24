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
