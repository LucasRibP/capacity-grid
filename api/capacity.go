package main

import (
	"context"
	"errors"
	"fmt"
	"time"

	openapi_types "github.com/oapi-codegen/runtime/types"

	"capacity/api/oapi"
)

// maxWeeks caps a request to a quarter: the horizon a manager plans in, and a bound on the
// people × weeks rows a single query produces at production size.
const maxWeeks = 13

const day = 24 * time.Hour

var (
	errFromAfterTo   = errors.New("from: must not be after to")
	errRangeTooLarge = fmt.Errorf("the range covers more than %d weeks; pick a shorter range", maxWeeks)
)

// weekRange is a requested range widened to whole ISO weeks: first is a Monday, last is a Sunday.
type weekRange struct {
	first, last time.Time
}

// newWeekRange widens [from, to] to whole ISO weeks (Monday to Sunday) and enforces the
// maxWeeks cap on the widened range.
func newWeekRange(from, to time.Time) (weekRange, error) {
	if from.After(to) {
		return weekRange{}, errFromAfterTo
	}
	r := weekRange{first: mondayOf(from), last: mondayOf(to).Add(6 * day)}
	if r.weeks() > maxWeeks {
		return weekRange{}, errRangeTooLarge
	}
	return r, nil
}

// mondayOf returns the Monday of t's ISO week. Dates are UTC midnights, so adding days is exact.
func mondayOf(t time.Time) time.Time {
	sinceMonday := (int(t.Weekday()) + 6) % 7
	return t.AddDate(0, 0, -sinceMonday)
}

func (r weekRange) weeks() int {
	return int(r.last.Sub(r.first)/day+1) / 7
}

// mondays lists the first day of every week in the range, ascending.
func (r weekRange) mondays() []openapi_types.Date {
	out := make([]openapi_types.Date, r.weeks())
	for i := range out {
		out[i] = openapi_types.Date{Time: r.first.AddDate(0, 0, 7*i)}
	}
	return out
}

// capacityQuery returns one row per person per week, ordered by name, id, week.
//
// Weeks are generated in SQL so people with no assignment still get a row (LEFT JOIN → 0).
// An assignment contributes hours_per_day for every weekday it covers in a week: within one week,
// Mon..Fri is the contiguous span [week_start, week_start + 4], so the weekday count is the length
// of the overlap between that span and [start_date, end_date]. Weekend days fall outside the span
// and never count. Fragments of one assignment are separate rows and are summed like any other.
// Sums stay numeric until the scan; the WHERE clause keeps the scan to the requested range.
const capacityQuery = `
WITH weeks AS (
  SELECT generate_series($1::date, $2::date - 6, interval '7 days')::date AS week_start
),
allocated AS (
  SELECT a.person_id, w.week_start,
         sum(a.hours_per_day * (least(a.end_date, w.week_start + 4) - greatest(a.start_date, w.week_start) + 1)) AS hours
  FROM assignments a
  JOIN weeks w ON a.start_date <= w.week_start + 4 AND a.end_date >= w.week_start
  WHERE a.start_date <= $2::date AND a.end_date >= $1::date
  GROUP BY a.person_id, w.week_start
)
SELECT p.id, p.name, p.weekly_hours::float8, w.week_start, coalesce(al.hours, 0)::float8
FROM people p
CROSS JOIN weeks w
LEFT JOIN allocated al ON al.person_id = p.id AND al.week_start = w.week_start
ORDER BY p.name, p.id, w.week_start`

// GetCapacity serves GET /api/capacity?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// For every person and every ISO week (Monday to Sunday) overlapping the range: allocated hours
// (weekdays only) and weekly capacity. Shape and rules: contract/openapi.yaml.
func (s *server) GetCapacity(ctx context.Context, req oapi.GetCapacityRequestObject) (oapi.GetCapacityResponseObject, error) {
	r, err := newWeekRange(req.Params.From.Time, req.Params.To.Time)
	if err != nil {
		code := oapi.ValidationFailed
		if errors.Is(err, errRangeTooLarge) {
			code = oapi.RangeTooLarge
		}
		return oapi.GetCapacity400JSONResponse{ErrorJSONResponse: oapi.ErrorJSONResponse{Code: code, Message: err.Error()}}, nil
	}

	people, err := s.capacity(ctx, r)
	if err != nil {
		return nil, err
	}
	return oapi.GetCapacity200JSONResponse{
		From:   openapi_types.Date{Time: r.first},
		To:     openapi_types.Date{Time: r.last},
		Weeks:  r.mondays(),
		People: people,
	}, nil
}

func (s *server) capacity(ctx context.Context, r weekRange) ([]oapi.PersonCapacity, error) {
	rows, err := s.db.Query(ctx, capacityQuery, r.first, r.last)
	if err != nil {
		return nil, fmt.Errorf("query capacity: %w", err)
	}
	defer rows.Close()

	weeks := r.weeks()
	people := []oapi.PersonCapacity{}
	for rows.Next() {
		var (
			id          int64
			name        string
			weeklyHours float64
			weekStart   time.Time
			allocated   float64
		)
		if err := rows.Scan(&id, &name, &weeklyHours, &weekStart, &allocated); err != nil {
			return nil, fmt.Errorf("scan capacity: %w", err)
		}
		if n := len(people); n == 0 || people[n-1].Id != id {
			people = append(people, oapi.PersonCapacity{
				Id: id, Name: name, WeeklyHours: weeklyHours, Weeks: make([]oapi.PersonWeek, 0, weeks),
			})
		}
		p := &people[len(people)-1]
		p.Weeks = append(p.Weeks, oapi.PersonWeek{
			WeekStart:      openapi_types.Date{Time: weekStart},
			AllocatedHours: allocated,
			CapacityHours:  weeklyHours,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read capacity: %w", err)
	}
	return people, nil
}
