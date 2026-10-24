package main

import (
	"context"
	"net/http"

	"capacity/api/oapi"
)

// GetCapacity serves GET /api/capacity?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// For every person and every ISO week (Monday to Sunday) overlapping the range: allocated hours
// (weekdays only) and weekly capacity. Shape and rules: contract/openapi.yaml.
//
// TODO: implement (issue B1).
func (s *server) GetCapacity(_ context.Context, _ oapi.GetCapacityRequestObject) (oapi.GetCapacityResponseObject, error) {
	return oapi.GetCapacitydefaultJSONResponse{
		StatusCode: http.StatusNotImplemented,
		Body:       oapi.Error{Code: "not_implemented", Message: "Capacity is not available yet."},
	}, nil
}
