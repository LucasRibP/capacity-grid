package main

import (
	"context"
	"net/http"

	"capacity/api/oapi"
)

// UpdatePerson serves PATCH /api/people/{id}
//
// Updates the person's weekly hours and returns the updated person. Allocations do not depend on
// weekly hours, so the grid only needs this person's new capacity. Shape: contract/openapi.yaml.
//
// TODO: implement (issue B2).
func (s *server) UpdatePerson(_ context.Context, _ oapi.UpdatePersonRequestObject) (oapi.UpdatePersonResponseObject, error) {
	return oapi.UpdatePersondefaultJSONResponse{
		StatusCode: http.StatusNotImplemented,
		Body:       oapi.Error{Code: "not_implemented", Message: "Editing capacity is not available yet."},
	}, nil
}
