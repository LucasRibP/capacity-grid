## Description

> **TL;DR** — <what changed>. <effect for the manager or the system>.

Closes #<issue>

<!--
Title: <type>(<issueNumber>): <PR name>, e.g. feat(2): Serve capacity per person per week.
Types: feat, fix, refactor, perf, test, docs, build, ci, chore.
Keep "Closes #<issue>" above so the issue closes on merge. One issue per PR.
Optional ### subsections: Decisions, Out of scope. Delete what doesn't apply.
-->

## How do I test this?

- [ ] <each "Done when" item from the issue> — <evidence: command, curl result, test name, screenshot>

## Not done / follow-ups

<Anything left out on purpose, or "None".>

## Checklist

- [ ] `cd api && go vet ./... && go test ./... && golangci-lint run ./...` (if `api/` changed)
- [ ] `cd web && npm run check` (if `web/` changed)
- [ ] Contract changed → `go generate ./...` and `npm run gen` output committed
- [ ] `.notes/worklog.md` has the decisions and anything left unfinished
- [ ] No changes to `DECISIONS.md`, `db/`, Dockerfiles, `docker-compose.yml` or the Makefile
