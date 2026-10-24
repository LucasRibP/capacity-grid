package main

import (
	"context"
	"os"
	"slices"
	"strings"
	"testing"
	"unicode"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestSearchTermsSplitsOnWhitespaceAndTreatsBlankAsNoFilter(t *testing.T) {
	t.Parallel()

	str := func(s string) *string { return &s }
	cases := []struct {
		name string
		q    *string
		want []string
	}{
		{"missing", nil, []string{}},
		{"empty", str(""), []string{}},
		{"only whitespace", str(" \t\n "), []string{}},
		{"one term, trimmed", str("  søren "), []string{"søren"}},
		{"runs of whitespace", str("soren \t  hag"), []string{"soren", "hag"}},
		{"wildcards stay literal", str("% _"), []string{"%", "_"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			got := searchTerms(tc.q)
			if got == nil {
				t.Fatal("terms are nil; pgx would send NULL instead of an empty array")
			}
			if !slices.Equal(got, tc.want) {
				t.Errorf("terms = %q, want %q", got, tc.want)
			}
		})
	}
}

// translate() maps foldFrom to foldTo by position: one missing letter shifts every fold after it.
func TestFoldMapIsAlignedAndFoldsToPlainLetters(t *testing.T) {
	t.Parallel()

	from, to := []rune(foldFrom), []rune(foldTo)
	if len(from) != len(to) {
		t.Fatalf("foldFrom has %d letters, foldTo %d", len(from), len(to))
	}
	seen := map[rune]bool{}
	for i, r := range from {
		if seen[r] {
			t.Errorf("%c appears twice in foldFrom", r)
		}
		seen[r] = true
		if r < utf8.RuneSelf || !unicode.IsLower(r) {
			t.Errorf("%c: foldFrom must hold lowercase non-ASCII letters (names are lowercased first)", r)
		}
		if to[i] >= utf8.RuneSelf && !unicode.Is(unicode.Greek, to[i]) {
			t.Errorf("%c folds to %c, which is not plain ASCII", r, to[i])
		}
	}
}

// The matching itself lives in SQL, so it is checked against a real Postgres loaded with the seed.
// Opt-in: set CAPACITY_TEST_DATABASE_URL (the shared stack's database is not published on the host,
// so run the test binary on its Docker network; see .notes/worklog.md).
func TestCapacitySearchAgainstSeed(t *testing.T) {
	dsn := os.Getenv("CAPACITY_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("CAPACITY_TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	db, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	s := &server{db: db}
	r, err := newWeekRange(date(t, "2025-12-29"), date(t, "2026-01-16"))
	if err != nil {
		t.Fatal(err)
	}

	search := func(t *testing.T, q string) []string {
		t.Helper()
		people, err := s.capacity(ctx, r, searchTerms(&q))
		if err != nil {
			t.Fatal(err)
		}
		names := make([]string, len(people))
		for i, p := range people {
			names[i] = p.Name
			if len(p.Weeks) != r.weeks() {
				t.Errorf("%s has %d weeks, want %d", p.Name, len(p.Weeks), r.weeks())
			}
		}
		return names
	}
	everyone := search(t, "")

	t.Run("blank q returns everyone in name order", func(t *testing.T) {
		if len(everyone) != 500 {
			t.Errorf("got %d people, want 500", len(everyone))
		}
		if got := search(t, "   "); !slices.Equal(got, everyone) {
			t.Error("whitespace-only q differs from no q")
		}
	})
	t.Run("case and accents fold the same way on both sides", func(t *testing.T) {
		plain := search(t, "soren")
		if len(plain) == 0 {
			t.Fatal("soren found nobody")
		}
		for _, q := range []string{"SØREN", "Søren", "sØrEn"} {
			if got := search(t, q); !slices.Equal(got, plain) {
				t.Errorf("q=%s: %q, want %q", q, got, plain)
			}
		}
	})
	t.Run("multi-letter folds", func(t *testing.T) {
		for q, want := range map[string]string{"thor": "Þórsdóttir", "kjaer": "Kjærgaard", "huong": "Hương", "simunovic": "Šimunović"} {
			got := search(t, q)
			if len(got) == 0 || !strings.Contains(got[0], want) {
				t.Errorf("q=%s: first is %q, want a %s", q, got, want)
			}
		}
	})
	t.Run("every term must match, in any order, best word-start first", func(t *testing.T) {
		got := search(t, "hag soren")
		if len(got) == 0 || got[0] != "Søren Hagen" {
			t.Fatalf("hag soren: %q, want Søren Hagen first", got)
		}
		if again := search(t, "soren hag"); !slices.Equal(again, got) {
			t.Errorf("term order changed the result: %q vs %q", again, got)
		}
		for _, name := range got {
			folded := strings.ToLower(strings.NewReplacer("ø", "o", "Ø", "o").Replace(name))
			if !strings.Contains(folded, "soren") || !strings.Contains(folded, "hag") {
				t.Errorf("%s does not contain both terms", name)
			}
		}
	})
	t.Run("word-start matches rank above mid-word ones", func(t *testing.T) {
		got := search(t, "an")
		wordStart := func(name string) bool { return strings.Contains(" "+strings.ToLower(name), " an") }
		firstMid := slices.IndexFunc(got, func(n string) bool { return !wordStart(n) })
		if firstMid <= 0 {
			t.Fatalf("an: want word-start matches then mid-word ones, got first mid-word at %d", firstMid)
		}
		if i := slices.IndexFunc(got[firstMid:], wordStart); i >= 0 {
			t.Errorf("%s (word start) ranked after %s (mid-word)", got[firstMid+i], got[firstMid])
		}
	})
	t.Run("percent and underscore are literal", func(t *testing.T) {
		for _, q := range []string{"%", "_", "s%n"} {
			if got := search(t, q); len(got) != 0 {
				t.Errorf("q=%s matched %d people", q, len(got))
			}
		}
	})
	t.Run("non-Latin scripts match in their own script", func(t *testing.T) {
		if got := search(t, "петрова"); !slices.Equal(got, []string{"Нина Петрова"}) {
			t.Errorf("петрова: %q", got)
		}
	})
}
