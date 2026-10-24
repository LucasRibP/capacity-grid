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
	"github.com/klauspost/compress/gzhttp"
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
				writeError(w, http.StatusBadRequest, oapi.ValidationFailed, err.Error())
			},
			ResponseErrorHandlerFunc: func(w http.ResponseWriter, _ *http.Request, err error) {
				log.Printf("handler error: %v", err)
				writeError(w, http.StatusInternalServerError, oapi.Internal, "something went wrong, try again")
			},
		}),
		oapi.StdHTTPServerOptions{
			BaseURL:    "/api",
			BaseRouter: mux,
			ErrorHandlerFunc: func(w http.ResponseWriter, _ *http.Request, err error) {
				writeError(w, http.StatusBadRequest, oapi.ValidationFailed, paramMessage(err))
			},
		},
	)

	validate := middleware.OapiRequestValidatorWithOptions(spec, &middleware.Options{
		SilenceServersWarning: true,
		ErrorHandlerWithOpts: func(_ context.Context, err error, w http.ResponseWriter, _ *http.Request, opts middleware.ErrorHandlerOpts) {
			code := oapi.ValidationFailed
			if opts.StatusCode == http.StatusNotFound {
				code = oapi.NotFound
			}
			writeError(w, opts.StatusCode, code, validationMessage(err))
		},
	})
	// gzip when the client accepts it: a full roster is megabytes of JSON. Bodies under 1 KB stay
	// plain, and Vary: Accept-Encoding is set either way so caches keep the two apart.
	return gzhttp.GzipHandler(validate(mux)), nil
}

func (s *server) GetHealth(ctx context.Context, _ oapi.GetHealthRequestObject) (oapi.GetHealthResponseObject, error) {
	var people int64
	if err := s.db.QueryRow(ctx, `SELECT count(*) FROM people`).Scan(&people); err != nil {
		return nil, fmt.Errorf("count people: %w", err)
	}
	return oapi.GetHealth200JSONResponse{Ok: true, People: people}, nil
}

// validationMessage turns a kin-openapi error (multi-line, schema dump included) into one line a
// manager can read, in the form "field: reason", e.g. "weeklyHours: number must be at most 168".
// Errors about the body as a whole (missing, not JSON, unknown property) use "body" as the field.
func validationMessage(err error) string {
	var schemaErr *openapi3.SchemaError
	if errors.As(err, &schemaErr) {
		return schemaMessage(err, schemaErr)
	}

	var reqErr *openapi3filter.RequestError
	if !errors.As(err, &reqErr) {
		return err.Error()
	}
	switch {
	case reqErr.Parameter != nil && errors.Is(reqErr.Err, openapi3filter.ErrInvalidRequired):
		return reqErr.Parameter.Name + ": " + requiredReason
	case reqErr.Parameter != nil:
		// The value has the wrong type for the parameter, e.g. id=abc or an id beyond int64.
		return reqErr.Parameter.Name + ": " + paramReason(reqErr.Parameter.Name)
	case reqErr.RequestBody != nil && errors.Is(reqErr.Err, openapi3filter.ErrInvalidRequired):
		return "body: " + requiredReason
	case reqErr.RequestBody != nil && reqErr.Err != nil:
		return "body: must be valid JSON"
	case reqErr.RequestBody != nil:
		return "body: must be sent as application/json"
	case reqErr.Reason != "":
		return reqErr.Reason
	default:
		return err.Error()
	}
}

// schemaMessage names the offending field: the JSON pointer inside the body, else the parameter,
// else the body itself (e.g. an unknown property).
func schemaMessage(err error, schemaErr *openapi3.SchemaError) string {
	field := "body"
	var reqErr *openapi3filter.RequestError
	if errors.As(err, &reqErr) && reqErr.Parameter != nil {
		field = reqErr.Parameter.Name
	}
	if ptr := schemaErr.JSONPointer(); len(ptr) > 0 {
		field = strings.Join(ptr, ".")
	}

	reason := schemaErr.Reason
	switch {
	case schemaErr.SchemaField == "required":
		reason = requiredReason // instead of `property "weeklyHours" is missing` after the field name
	case schemaErr.SchemaField == "format" && schemaErr.Schema != nil && schemaErr.Schema.Format == "date":
		reason = dateReason
	}
	return field + ": " + reason
}

const (
	// requiredReason matches what kin-openapi says for a missing parameter, so all "missing" errors read alike.
	requiredReason = "value is required but missing"
	// dateReason replaces the date-format regex kin-openapi would otherwise show the manager.
	dateReason = "must be a date in YYYY-MM-DD format"
)

// paramMessage covers parameters that pass the spec's pattern but fail to bind, e.g. 2026-02-30.
func paramMessage(err error) string {
	var formatErr *oapi.InvalidParamFormatError
	if !errors.As(err, &formatErr) {
		return err.Error()
	}
	return formatErr.ParamName + ": " + paramReason(formatErr.ParamName)
}

// paramReason explains a parameter value of the wrong type. The only typed parameters are dates
// and the path id, so the reason is chosen by name.
func paramReason(name string) string {
	if name == "id" {
		return "must be a positive whole number"
	}
	return dateReason
}

func writeError(w http.ResponseWriter, status int, code oapi.ErrorCode, message string) {
	writeJSON(w, status, oapi.Error{Code: code, Message: message})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
