package main

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"capacity/api/oapi"
)

// rosterServer answers GetCapacity with a roster big enough to be worth compressing, without a database.
type rosterServer struct {
	oapi.StrictServerInterface
}

func (rosterServer) GetCapacity(context.Context, oapi.GetCapacityRequestObject) (oapi.GetCapacityResponseObject, error) {
	grid := oapi.CapacityGrid{}
	for i := range 200 {
		grid.People = append(grid.People, oapi.PersonCapacity{
			Id: int64(i + 1), Name: fmt.Sprintf("Person %d", i+1), WeeklyHours: 40,
			Weeks: []oapi.PersonWeek{{AllocatedHours: 32, CapacityHours: 40}},
		})
	}
	return oapi.GetCapacity200JSONResponse(grid), nil
}

// A client that accepts gzip gets the same JSON compressed; one that does not gets it plain. Errors stay
// valid JSON either way.
func TestHandlerCompressesWhenClientAcceptsGzip(t *testing.T) {
	t.Parallel()

	handler, err := newHandler(rosterServer{})
	if err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		name, target string
		gzip         bool
		wantStatus   int
		wantEncoding string
	}{
		{"roster without gzip", "/api/capacity?from=2025-12-29&to=2026-01-16", false, http.StatusOK, ""},
		{"roster with gzip", "/api/capacity?from=2025-12-29&to=2026-01-16", true, http.StatusOK, "gzip"},
		{"error without gzip", "/api/capacity?from=nope&to=2026-01-16", false, http.StatusBadRequest, ""},
		{"small error with gzip stays plain", "/api/capacity?from=nope&to=2026-01-16", true, http.StatusBadRequest, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, tc.target, http.NoBody)
			if tc.gzip {
				req.Header.Set("Accept-Encoding", "gzip")
			}
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)

			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d", rec.Code, tc.wantStatus)
			}
			if got := rec.Header().Get("Content-Encoding"); got != tc.wantEncoding {
				t.Errorf("Content-Encoding = %q, want %q", got, tc.wantEncoding)
			}
			if got := rec.Header().Get("Vary"); got != "Accept-Encoding" {
				t.Errorf("Vary = %q, want Accept-Encoding", got)
			}

			var body io.Reader = rec.Body
			if tc.wantEncoding == "gzip" {
				zr, err := gzip.NewReader(rec.Body)
				if err != nil {
					t.Fatal(err)
				}
				body = zr
			}
			var v map[string]any
			if err := json.NewDecoder(body).Decode(&v); err != nil {
				t.Fatalf("body is not valid JSON: %v", err)
			}
		})
	}
}
