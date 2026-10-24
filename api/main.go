package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/jackc/pgx/v5/pgxpool"
	middleware "github.com/oapi-codegen/nethttp-middleware"

	"capacity/api/oapi"
)

// server implements oapi.StrictServerInterface, generated from contract/openapi.yaml.
type server struct {
	db *pgxpool.Pool
}

var _ oapi.StrictServerInterface = (*server)(nil)

func main() {
	if err := run(context.Background()); err != nil {
		log.Fatal(err)
	}
}

func run(ctx context.Context) error {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://capacity:capacity@localhost:5432/capacity?sslmode=disable" //nolint:gosec // local dev default, same as docker-compose.yml
	}

	db, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return fmt.Errorf("connect: %w", err)
	}
	defer db.Close()

	for range 30 {
		if err = db.Ping(ctx); err == nil {
			break
		}
		time.Sleep(time.Second)
	}
	if err != nil {
		return fmt.Errorf("ping: %w", err)
	}

	handler, err := newHandler(&server{db: db})
	if err != nil {
		return err
	}

	srv := &http.Server{
		Addr:              ":8080",
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
	}
	log.Println("listening on :8080")
	return srv.ListenAndServe()
}

// newHandler routes every operation in the contract to s. Requests are validated against the
// embedded spec before they reach a handler, so handlers only check what the spec cannot express.
func newHandler(s oapi.StrictServerInterface) (http.Handler, error) {
	spec, err := oapi.GetSwagger()
	if err != nil {
		return nil, fmt.Errorf("load embedded spec: %w", err)
	}

	mux := http.NewServeMux()
	oapi.HandlerWithOptions(
		oapi.NewStrictHandlerWithOptions(s, nil, oapi.StrictHTTPServerOptions{
			RequestErrorHandlerFunc: func(w http.ResponseWriter, _ *http.Request, err error) {
				writeError(w, http.StatusBadRequest, "validation_failed", err.Error())
			},
			ResponseErrorHandlerFunc: func(w http.ResponseWriter, _ *http.Request, err error) {
				log.Printf("handler error: %v", err)
				writeError(w, http.StatusInternalServerError, "internal", "Something went wrong. Try again.")
			},
		}),
		oapi.StdHTTPServerOptions{
			BaseURL:    "/api",
			BaseRouter: mux,
			ErrorHandlerFunc: func(w http.ResponseWriter, _ *http.Request, err error) {
				writeError(w, http.StatusBadRequest, "validation_failed", paramMessage(err))
			},
		},
	)

	validate := middleware.OapiRequestValidatorWithOptions(spec, &middleware.Options{
		SilenceServersWarning: true,
		ErrorHandlerWithOpts: func(_ context.Context, err error, w http.ResponseWriter, _ *http.Request, opts middleware.ErrorHandlerOpts) {
			code := "validation_failed"
			if opts.StatusCode == http.StatusNotFound {
				code = "not_found"
			}
			writeError(w, opts.StatusCode, code, validationMessage(err))
		},
	})
	return validate(mux), nil
}

func (s *server) GetHealth(ctx context.Context, _ oapi.GetHealthRequestObject) (oapi.GetHealthResponseObject, error) {
	var people int64
	if err := s.db.QueryRow(ctx, `SELECT count(*) FROM people`).Scan(&people); err != nil {
		return nil, fmt.Errorf("count people: %w", err)
	}
	return oapi.GetHealth200JSONResponse{Ok: true, People: people}, nil
}

// validationMessage turns a kin-openapi error (multi-line, schema dump included) into one line a
// manager can read, e.g. "weeklyHours: number must be at most 168".
func validationMessage(err error) string {
	field := ""
	var reqErr *openapi3filter.RequestError
	if errors.As(err, &reqErr) && reqErr.Parameter != nil {
		field = reqErr.Parameter.Name
	}

	reason := err.Error()
	var schemaErr *openapi3.SchemaError
	switch {
	case errors.As(err, &schemaErr):
		if ptr := schemaErr.JSONPointer(); len(ptr) > 0 {
			field = strings.Join(ptr, ".")
		}
		reason = schemaErr.Reason
		if schemaErr.SchemaField == "format" && schemaErr.Schema != nil && schemaErr.Schema.Format == "date" {
			reason = dateReason
		}
	case reqErr != nil && reqErr.Reason != "":
		reason = reqErr.Reason
	case reqErr != nil && reqErr.Err != nil:
		reason = reqErr.Err.Error()
	}

	if field == "" {
		return reason
	}
	return field + ": " + reason
}

// dateReason replaces the date-format regex kin-openapi would otherwise show the manager.
const dateReason = "must be a date in YYYY-MM-DD format"

// paramMessage covers parameters that pass the spec's pattern but fail to bind, e.g. 2026-02-30.
// The only formatted parameters are dates and the path id, so the reason is chosen by name.
func paramMessage(err error) string {
	var formatErr *oapi.InvalidParamFormatError
	if !errors.As(err, &formatErr) {
		return err.Error()
	}
	if formatErr.ParamName == "id" {
		return "id: must be a positive whole number"
	}
	return formatErr.ParamName + ": " + dateReason
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, oapi.Error{Code: code, Message: message})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
