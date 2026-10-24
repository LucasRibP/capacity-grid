# Capacity

Team capacity view: who is allocated how much, week by week, and who is over-committed.
Go API + Postgres, React frontend, all wired through Docker Compose, joined by one OpenAPI contract.

This file is for any coding agent. `AGENTS.md` and `CLAUDE.md` are the same file (symlink).

## What You Are Building

| Where | What | Issue |
|-------|------|-------|
| `contract/openapi.yaml` | The HTTP contract. Go server and web client are generated from it | #1 |
| `api/capacity.go` | `GET /api/capacity?from=&to=`: allocated hours and capacity, per person, per week | #2 |
| `api/people.go` | `PATCH /api/people/{id}`: update a person's weekly hours | #3 |
| `web/src/CapacityGrid.tsx` | The grid: over-allocation obvious at a glance, week navigation, date range selection | #5, #6 |
| `web/` | Editing weekly hours from the grid; the grid stays correct after a save | #7 |

Issues live in GitHub: `LucasRibP/capacity-grid` (`gh issue view <n> --repo LucasRibP/capacity-grid`). Read the
issue you were given before starting, including its "Done when" section.

This capacity view will be one component of a team overview page. Build only the capacity view. Production serves a
few thousand people and up to two years of history; the seed is smaller. Design for the real one.

## Critical Rules

- **NEVER edit `DECISIONS.md`.** The human writes it, not an agent. Leave it alone even if asked to tidy the repo.
- **NEVER edit `db/schema.sql` or `db/seed.sql`.** The data is fixed input.
- **NEVER change `docker-compose.yml`, the `Dockerfile`s, or the `Makefile`.** Submissions that alter the run
  environment cannot be built by the reviewers.
- **NEVER touch anything outside this repository.** No `../` paths, no other projects, no templates, no global
  config. Everything you need is in here.
- **Stay in your track.** Several agents work in this checkout at the same time:
  - Backend agent: `api/` only, except `api/oapi/oapi.gen.go`.
  - Frontend agent: `web/` only, except `web/src/api/generated/`.
  - `contract/` and all generated code change only in a dedicated contract change made by the coordinating
    session. If your issue needs a contract change, stop and report what you need and why. Do not edit it.
  - `.notes/worklog.md` is shared and append-only: add your entries at the end, never rewrite others'.
- **Product decisions belong to the human.** The agreed ones are listed below. If your task needs a product decision
  that is not listed (what the manager sees, what a number means, a rule about the data), stop and ask instead of
  deciding. Implementation choices inside those decisions are yours; record the non-obvious ones in the worklog.

## Language

Everything written to the repository is in **English**: code, identifiers, comments, UI copy, commit messages,
`.notes/worklog.md`, issue and PR text. Talk to the human in whatever language they use.

## Agreed Product Decisions

Source of truth: the "Planning" section of `.notes/worklog.md` and the issues. Do not change these.

- **Contract-first.** `contract/openapi.yaml` feeds oapi-codegen (Go strict server, `std-http`) and Orval (TanStack
  Query hooks, Zod, MSW mocks). Generated code is committed so the fixed Dockerfiles build it.
- **Response shape: one object per person, one object per week inside it.** `{ from, to, weeks: [weekStart],
  people: [{ id, name, weeklyHours, weeks: [{ weekStart, allocatedHours, capacityHours }] }] }`. Every person carries
  every week of `weeks`, in the same order. Every person is returned, including people with no allocation, ordered by
  name then id.
- **Weeks are ISO (Monday to Sunday).** The requested range is widened to whole weeks.
- **At most 13 weeks per request** (a quarter). Larger ranges, invalid dates or `from > to` → 400. People pagination
  is deferred.
- **Working days only (Mon to Fri) count toward allocation.** `hours_per_day` rows are fragments of one assignment and
  must be summed. Weekend days of an assignment contribute nothing.
- **`capacityHours` = `weekly_hours`** for every week. The schema has no capacity history.
- **Saves are pessimistic.** The grid changes only after the server confirms. Then the person's `weeklyHours` and
  `capacityHours` are patched in every cached capacity query and revalidated in the background. Editing capacity never
  changes allocations, so the patch is exact.
- **A failed save** keeps the typed value in the editor, shows the server's message and a retry, and leaves the grid
  untouched. Client validation mirrors the contract (0 to 168).
- **No concurrency control: last write wins.** There is no `updated_at` or version column and the schema is fixed.
- **Errors** are `{ code, message }`. `message` is one line a manager can read; `code` is machine-readable
  (`validation_failed`, `range_too_large`, `not_found`, `internal`).

## Git Workflow

- All work happens on **`feat/capacity-view`**. Agents share this checkout, so **never** switch branches, rebase,
  reset, stash, amend, or force-push.
- Stage only your own files, by path (`git add api/capacity.go api/capacity_test.go`). Never `git add -A` or
  `git add .`: another agent's half-done work may be in the tree. Run `git status` before every commit.
- Commit after each green step. Small commits; never squash. The history is reviewed.
- Push only when the human asks. Do not close issues; report the "Done when" evidence instead.

### Commit messages

Every commit follows this format (Conventional Commits; the body explains the decision, not the diff):

```
<type>(<scope>): <imperative summary, lowercase, no period>

<Why this change, and the decision behind it. Wrap at ~110 columns.
Alternatives considered, if any. Not a list of edited files.>

Refs: #<issue>
Co-Authored-By: <your model name> <noreply@anthropic.com>
```

- `type`: `feat`, `fix`, `test`, `refactor`, `docs`, `chore`, `build`.
- `scope`: `api`, `web`, `contract`, `notes`, or another short area name.
- Omit `Refs:` only when no issue applies. Keep the `Co-Authored-By` trailer on AI-authored commits.

Example from this repository:

```
docs(notes): record planning decisions for the capacity view

Contract shape, ISO weeks, 13-week limit, working-days allocation and
pessimistic saves, with the reasoning behind each.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

## Running It

The human usually keeps `make up` running in the foreground. Do not stop it.

- Web on http://localhost:3000, API on http://localhost:8080. `GET /api/health` reports the seeded people count.
- Frontend changes hot-reload.
- After a backend change, rebuild only the API: `docker compose up -d --build api`.
- After adding an npm dependency, reinstall inside the container: `docker compose restart web`.
- Database shell: `docker compose exec db psql -U capacity -d capacity`. Read-only queries only.

If nothing is running: `make up` (foreground; run it in the background from an agent).

## Toolchain And Checks

Codegen and linters run on the host. The Docker images only build what is committed.

- **Go**: the host Go is newer than the image (1.26). Prefix Go commands with `GOTOOLCHAIN=local` and keep
  `go 1.26` in `api/go.mod`.
- **Backend check** (from `api/`):
  `GOTOOLCHAIN=local go build ./... && GOTOOLCHAIN=local go test ./... && golangci-lint run ./... && golangci-lint fmt --diff`
- **Frontend check** (from `web/`): `npm run check`, which runs `tsc`, ESLint (`--max-warnings=0`), Prettier and
  Vitest. Auto-fix with `npm run lint:fix`.
- **Regenerate after a contract change** (coordinating session only): `cd api/oapi && GOTOOLCHAIN=local go generate ./...`
  and `cd web && npm run gen`. Commit the contract and both generated outputs together.

A step is green only when its track's check passes. Do not disable a lint rule to get there; if a rule is wrong
for one line, use a targeted disable with a reason.

### Mocks (frontend before the backend exists)

- Vitest runs MSW in Node (`src/test/setup.ts`); any unhandled request fails the test. Override per test with
  `server.use(...)`.
- `src/api/mocks/handlers.ts` holds the default handlers. The generated ones return random, schema-valid data
  (weeks are not aligned across people). Put realistic hand-written handlers before them; MSW uses the first match.
- In the browser: `VITE_API_MOCK=true` in `web/.env.local` (git-ignored), then `docker compose restart web`. Or run a
  second dev server on the host: `cd web && VITE_API_MOCK=true npx vite --port 3001`. The embedded browser in some
  desktop apps blocks service workers; the app then falls back to the real API and logs an error. Use a regular
  browser to see mocks.

## Conventions

- **Go**: return errors, don't panic. Handlers implement `oapi.StrictServerInterface` and return the generated
  response types. Requests are already validated against the spec; handlers check only what the spec cannot express.
  Errors use the `{code, message}` shape.
- **SQL**: belongs in the query, never assembled from strings in Go. Parameters, not interpolation. Keep sums in
  `numeric` in SQL. Scope every query to the requested range so it stays cheap at production size.
- **TypeScript**: `strict` and `noUncheckedIndexedAccess` are on. No `any`.
- **Data fetching**: components never call generated `use*` hooks directly (lint enforces it). Wrap them in a domain
  hook (e.g. `useCapacity`) so cache keys and cache updates live in one place.
- **Dates**: treat them as `YYYY-MM-DD` strings. Never format a date built with `new Date('YYYY-MM-DD')` in local
  time: it is parsed as UTC and shows the previous day in negative UTC offsets (e.g. Brazil).
- **Tests**: a test or two around the parts you would be nervous to change beats a full suite. Test behaviour (what
  the manager sees, what the API returns), not implementation details.

## Known Facts About The Data

- 500 people, 3 projects, ~126k assignment rows from 2025-06-02 to 2027-01-03.
- `hours_per_day` is split across many rows per assignment (each ≤ 1.0); the per-assignment sum is 2 to 8 h/day.
- Many assignments start or end on a weekend (e.g. Ana Ferreira, 8 h/day, Mon 2025-12-29 to Sun 2026-01-04).
- Eli Nakamura (id 5) has `weekly_hours = 0` and still has allocations: watch for division by zero.
- The default range (2025-12-29 to 2026-01-16) crosses a year boundary and ends on a Friday.
- Names contain non-ASCII characters (ø, Þ, Ö) and many share first names.

## Working Notes

Keep `.notes/worklog.md` current. It is the running record a teammate would need to pick this up tomorrow. Append;
don't rewrite.

Worth writing down, a line or two each:

- A decision you made where the spec didn't say which way to go, and why
- An assumption you had to make about the data or the domain
- Something you tried that didn't work
- Something you knowingly left unfinished

Not worth writing down: a play-by-play of edits, or a summary of code that already reads clearly.

## Layout

- `contract/openapi.yaml`: the HTTP contract.
- `api/`: Go service. `main.go` wires the generated server and request validation; `capacity.go` and `people.go`
  are the endpoints; `oapi/` is generated.
- `web/`: Vite + React app. `App.tsx` sets the range; `CapacityGrid.tsx` renders it; `src/api/http.ts` is the fetch
  wrapper every generated hook uses; `src/api/generated/` is generated; `src/api/mocks/` and `src/test/` hold MSW.
- `db/`: `schema.sql` and `seed.sql`, loaded on first `make up`. Read-only.
- `.notes/`: working notes.

## Before You Call It Done

1. Your track's check passes.
2. Open the app (or `curl` the API) and read what it actually produces. Do the numbers say what you expect? Building
   without looking is the most common way this task goes wrong.
3. Append to `.notes/worklog.md` what you decided, assumed or left unfinished.
4. Report back with the issue's "Done when" items and the evidence for each.

## Further Reading

- [README.md](README.md): the brief, and what the reviewers look at
