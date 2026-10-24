package main

import (
	"bytes"
	"context"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// A request the client has abandoned (the grid aborts it on navigation or a new search) is not a
// server error: it is answered with 499 and nothing is logged. No database is needed: the pool
// points at a closed port and is never dialled once the ctx is done, and the control case shows
// that a real failure on the same pool is still logged and answered as internal.
//
// Not parallel: it captures the global logger, and parallel tests only start after this one ends.
func TestCancelledRequestIsNotAnInternalError(t *testing.T) {
	pool, err := pgxpool.New(t.Context(), "postgres://capacity@127.0.0.1:1/capacity?connect_timeout=1")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	handler, err := newHandler(&server{db: pool})
	if err != nil {
		t.Fatal(err)
	}

	var logs bytes.Buffer
	prev := log.Writer()
	log.SetOutput(&logs)
	t.Cleanup(func() { log.SetOutput(prev) })

	cases := []struct {
		name, method, target, body string
	}{
		{"capacity", http.MethodGet, "/api/capacity?from=2025-12-29&to=2026-01-16", ""},
		{"capacity with search", http.MethodGet, "/api/capacity?from=2025-12-29&to=2026-01-16&q=ana", ""},
		{"update person", http.MethodPatch, "/api/people/1", `{"weeklyHours":32}`},
	}
	serve := func(ctx context.Context, method, target, body string) (int, time.Duration) {
		req := httptest.NewRequestWithContext(ctx, method, target, strings.NewReader(body))
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		rec := httptest.NewRecorder()
		start := time.Now()
		handler.ServeHTTP(rec, req)
		return rec.Code, time.Since(start)
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			logs.Reset()
			ctx, cancel := context.WithCancel(t.Context())
			cancel()

			status, took := serve(ctx, tc.method, tc.target, tc.body)
			if status != statusClientClosedRequest {
				t.Errorf("status = %d, want %d", status, statusClientClosedRequest)
			}
			if took > 100*time.Millisecond {
				t.Errorf("took %v; a cancelled request must return without waiting on the database", took)
			}
			if logs.Len() > 0 {
				t.Errorf("cancelled request logged: %q", logs.String())
			}
		})
	}

	t.Run("control: unreachable database is internal", func(t *testing.T) {
		logs.Reset()
		status, _ := serve(t.Context(), cases[0].method, cases[0].target, "")
		if status != http.StatusInternalServerError {
			t.Errorf("status = %d, want 500", status)
		}
		if !strings.Contains(logs.String(), "handler error") {
			t.Errorf("internal error not logged; logs: %q", logs.String())
		}
	})
}
