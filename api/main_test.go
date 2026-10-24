package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"capacity/api/oapi"
)

// The embedded spec rejects malformed requests before they reach a handler, with the contract's
// JSON error shape. Handlers can rely on params being present and well-typed.
func TestHandlerValidatesRequestsAgainstContract(t *testing.T) {
	t.Parallel()

	handler, err := newHandler(&server{})
	if err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		name, method, target, body string
		wantStatus                 int
		wantCode                   string
	}{
		{"capacity without params", http.MethodGet, "/api/capacity", "", http.StatusBadRequest, "validation_failed"},
		{"capacity with bad date", http.MethodGet, "/api/capacity?from=nope&to=2026-01-16", "", http.StatusBadRequest, "validation_failed"},
		{"patch with negative hours", http.MethodPatch, "/api/people/1", `{"weeklyHours":-1}`, http.StatusBadRequest, "validation_failed"},
		{"patch with unknown field", http.MethodPatch, "/api/people/1", `{"weeklyHours":10,"name":"x"}`, http.StatusBadRequest, "validation_failed"},
		{"patch with non-numeric id", http.MethodPatch, "/api/people/abc", `{"weeklyHours":10}`, http.StatusBadRequest, "validation_failed"},
		{"unknown route", http.MethodGet, "/api/nope", "", http.StatusNotFound, "not_found"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			req := httptest.NewRequestWithContext(t.Context(), tc.method, tc.target, strings.NewReader(tc.body))
			if tc.body != "" {
				req.Header.Set("Content-Type", "application/json")
			}
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)

			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d; body: %s", rec.Code, tc.wantStatus, rec.Body)
			}
			var body oapi.Error
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatalf("body is not a JSON Error: %v; body: %s", err, rec.Body)
			}
			if body.Code != tc.wantCode {
				t.Errorf("code = %q, want %q", body.Code, tc.wantCode)
			}
		})
	}
}
