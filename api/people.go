package main

import (
	"context"
	"errors"
	"fmt"
	"math"

	"github.com/jackc/pgx/v5"

	"capacity/api/oapi"
)

// UpdatePerson serves PATCH /api/people/{id}
//
// Updates the person's weekly hours and returns the updated person. Allocations do not depend on
// weekly hours, so the grid only needs this person's new capacity. Shape: contract/openapi.yaml.
//
// The 0..168 range is enforced by the spec before this runs. Last write wins: the schema has no
// version column to detect a concurrent edit.
func (s *server) UpdatePerson(ctx context.Context, req oapi.UpdatePersonRequestObject) (oapi.UpdatePersonResponseObject, error) {
	if req.Body == nil {
		return oapi.UpdatePerson400JSONResponse{ErrorJSONResponse: oapi.ErrorJSONResponse{
			Code: oapi.ValidationFailed, Message: "body: value is required but missing",
		}}, nil
	}
	// people.id is a 32-bit serial: a larger id cannot exist, and would fail to encode as a parameter.
	if req.Id > math.MaxInt32 {
		return personNotFound(req.Id), nil
	}

	var p oapi.Person
	err := s.db.QueryRow(ctx,
		`UPDATE people SET weekly_hours = $2 WHERE id = $1 RETURNING id, name, weekly_hours::float8`,
		req.Id, req.Body.WeeklyHours,
	).Scan(&p.Id, &p.Name, &p.WeeklyHours)
	if errors.Is(err, pgx.ErrNoRows) {
		return personNotFound(req.Id), nil
	}
	if err != nil {
		return nil, fmt.Errorf("update person %d: %w", req.Id, err)
	}
	return oapi.UpdatePerson200JSONResponse(p), nil
}

func personNotFound(id int64) oapi.UpdatePerson404JSONResponse {
	return oapi.UpdatePerson404JSONResponse{Code: oapi.NotFound, Message: fmt.Sprintf("no person with id %d", id)}
}
