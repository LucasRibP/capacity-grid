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
		wantCode                   oapi.ErrorCode
		wantMsg                    string
	}{
		{"capacity without params", http.MethodGet, "/api/capacity", "", http.StatusBadRequest, oapi.ValidationFailed, "from: value is required but missing"},
		{"capacity with bad date", http.MethodGet, "/api/capacity?from=nope&to=2026-01-16", "", http.StatusBadRequest, oapi.ValidationFailed, "from: must be a date in YYYY-MM-DD format"},
		{"capacity with impossible date", http.MethodGet, "/api/capacity?from=2026-02-30&to=2026-03-01", "", http.StatusBadRequest, oapi.ValidationFailed, "from: must be a date in YYYY-MM-DD format"},
		{"capacity with from after to", http.MethodGet, "/api/capacity?from=2026-01-16&to=2025-12-29", "", http.StatusBadRequest, oapi.ValidationFailed, "from: must not be after to"},
		{"capacity over 13 weeks", http.MethodGet, "/api/capacity?from=2026-01-01&to=2026-12-31", "", http.StatusBadRequest, oapi.RangeTooLarge, "the range covers more than 13 weeks; pick a shorter range"},
		{"patch above max", http.MethodPatch, "/api/people/1", `{"weeklyHours":500}`, http.StatusBadRequest, oapi.ValidationFailed, "weeklyHours: number must be at most 168"},
		{"patch with negative hours", http.MethodPatch, "/api/people/1", `{"weeklyHours":-1}`, http.StatusBadRequest, oapi.ValidationFailed, "weeklyHours: number must be at least 0"},
		{"patch without weeklyHours", http.MethodPatch, "/api/people/1", `{}`, http.StatusBadRequest, oapi.ValidationFailed, "weeklyHours: value is required but missing"},
		{"patch with non-JSON body", http.MethodPatch, "/api/people/1", `nope`, http.StatusBadRequest, oapi.ValidationFailed, "body: must be valid JSON"},
		{"patch with truncated JSON", http.MethodPatch, "/api/people/1", `{"weeklyHours":`, http.StatusBadRequest, oapi.ValidationFailed, "body: must be valid JSON"},
		{"patch with unknown field", http.MethodPatch, "/api/people/1", `{"weeklyHours":10,"name":"x"}`, http.StatusBadRequest, oapi.ValidationFailed, `body: property "name" is unsupported`},
		{"patch with non-numeric id", http.MethodPatch, "/api/people/abc", `{"weeklyHours":10}`, http.StatusBadRequest, oapi.ValidationFailed, "id: must be a positive whole number"},
		{"patch with id beyond int64", http.MethodPatch, "/api/people/99999999999999999999", `{"weeklyHours":10}`, http.StatusBadRequest, oapi.ValidationFailed, "id: must be a positive whole number"},
		{"patch without body", http.MethodPatch, "/api/people/1", "", http.StatusBadRequest, oapi.ValidationFailed, "body: value is required but missing"},
		{"patch id beyond any person", http.MethodPatch, "/api/people/3000000000", `{"weeklyHours":10}`, http.StatusNotFound, oapi.NotFound, "no person with id 3000000000"},
		{"unknown route", http.MethodGet, "/api/nope", "", http.StatusNotFound, oapi.NotFound, ""},
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
			if strings.Contains(body.Message, "\n") {
				t.Errorf("message must be one line a manager can read, got %q", body.Message)
			}
			if tc.wantMsg != "" && body.Message != tc.wantMsg {
				t.Errorf("message = %q, want %q", body.Message, tc.wantMsg)
			}
		})
	}
}
