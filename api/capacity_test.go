package main

import (
	"errors"
	"testing"
	"time"
)

func date(t *testing.T, s string) time.Time {
	t.Helper()
	d, err := time.Parse(time.DateOnly, s)
	if err != nil {
		t.Fatal(err)
	}
	return d
}

func TestNewWeekRangeWidensToWholeISOWeeks(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name, from, to      string
		wantFirst, wantLast string
		wantWeeks           int
	}{
		{"default range across new year, ends on a friday", "2025-12-29", "2026-01-16", "2025-12-29", "2026-01-18", 3},
		{"sunday start moves back to its monday", "2026-01-04", "2026-01-04", "2025-12-29", "2026-01-04", 1},
		{"monday end moves forward to its sunday", "2026-01-05", "2026-01-05", "2026-01-05", "2026-01-11", 1},
		{"midweek to midweek", "2026-01-07", "2026-01-14", "2026-01-05", "2026-01-18", 2},
		{"exactly 13 weeks after widening", "2026-01-07", "2026-04-01", "2026-01-05", "2026-04-05", 13},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			r, err := newWeekRange(date(t, tc.from), date(t, tc.to))
			if err != nil {
				t.Fatal(err)
			}
			if got := r.first.Format(time.DateOnly); got != tc.wantFirst {
				t.Errorf("first = %s, want %s", got, tc.wantFirst)
			}
			if got := r.last.Format(time.DateOnly); got != tc.wantLast {
				t.Errorf("last = %s, want %s", got, tc.wantLast)
			}
			mondays := r.mondays()
			if len(mondays) != tc.wantWeeks {
				t.Fatalf("weeks = %d, want %d", len(mondays), tc.wantWeeks)
			}
			for _, m := range mondays {
				if m.Weekday() != time.Monday {
					t.Errorf("week start %s is a %s", m.Format(time.DateOnly), m.Weekday())
				}
			}
		})
	}
}

func TestNewWeekRangeRejectsInvalidRanges(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name, from, to string
		want           error
	}{
		{"from after to", "2026-01-16", "2025-12-29", errFromAfterTo},
		// 2026-01-07..2026-04-06 is under 13 weeks of days, but widened to Mon..Sun it spans 14.
		{"14 weeks only after widening", "2026-01-07", "2026-04-06", errRangeTooLarge},
		{"two years", "2025-06-02", "2027-01-03", errRangeTooLarge},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			if _, err := newWeekRange(date(t, tc.from), date(t, tc.to)); !errors.Is(err, tc.want) {
				t.Errorf("err = %v, want %v", err, tc.want)
			}
		})
	}
}
