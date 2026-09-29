package search

import (
	"context"
	"errors"
	"fmt"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/embed"
)

// Stable degradation codes carried in SearchResponse.fallback_code. They are
// additive to fallback_reason: a client that only reads fallback_reason keeps
// working, while a client that needs to branch on cause gets an identifier
// whose wording never changes.
const (
	FallbackBackendUnavailable  = "embedding_backend_unavailable"
	FallbackCapacityExhausted   = "embedding_capacity_exhausted"
	FallbackInvalidResponse     = "embedding_invalid_response"
	FallbackNoEmbeddingCoverage = "no_embedding_coverage"
	FallbackDenseQueryFailed    = "dense_query_failed"
)

// Static public messages. Raw backend, SQL and circuit text never reaches the
// response, so a degraded search is not a disclosure surface.
const (
	msgBackendUnavailable = "semantic backend unavailable"
	msgCapacityExhausted  = "semantic backend capacity exhausted"
	msgInvalidResponse    = "semantic backend returned an unusable response"
	msgDenseQueryFailed   = "dense vector query failed"
)

// UnavailableError reports that a search could not use the semantic leg. The
// HTTP gateway renders it as 503 with a Retry-After header when a retry time
// is known, and the gRPC server reports it as codes.Unavailable.
type UnavailableError struct {
	Code    string
	RetryAt time.Time
	Message string
}

func (e *UnavailableError) Error() string {
	message := e.Message
	if message == "" {
		message = msgBackendUnavailable
	}
	if e.Code == "" {
		return message
	}
	return fmt.Sprintf("%s (code=%s)", message, e.Code)
}

// GRPCStatus keeps the gRPC transport from flattening the failure into
// codes.Unknown, which proxies would otherwise surface as a server bug.
func (e *UnavailableError) GRPCStatus() *status.Status {
	return status.New(codes.Unavailable, e.Error())
}

// Unavailable classifies an embedding failure into a stable public code, a
// safe static message and the backend's own retry time.
func Unavailable(err error) *UnavailableError {
	code, message := FallbackBackendUnavailable, msgBackendUnavailable
	switch {
	case errors.Is(err, embed.ErrCapacityExhausted):
		code, message = FallbackCapacityExhausted, msgCapacityExhausted
	case errors.Is(err, embed.ErrInvalidResponse):
		code, message = FallbackInvalidResponse, msgInvalidResponse
	}
	retryAt, _ := embed.RetryTime(err)
	return &UnavailableError{Code: code, RetryAt: retryAt, Message: message}
}

// semanticFallbackCode is the hybrid-search counterpart of Unavailable: the
// dense leg failed, the sparse leg still runs, and the caller gets a code and
// a safe static reason instead of the backend's own words.
func semanticFallbackCode(err error) (code, message string) {
	unavailable := Unavailable(err)
	return unavailable.Code, unavailable.Message
}

// semanticRetryAt reports when the semantic backend expects to accept traffic
// again, if the failure carried one.
func semanticRetryAt(err error) time.Time {
	retryAt, _ := embed.RetryTime(err)
	return retryAt
}

// searchLegFailure converts a dense-leg failure into the error a dense-only
// search returns. The caller's own deadline and request-validation problems
// are not backend outages, so they pass through untouched and keep their
// existing status mapping.
func searchLegFailure(ctx context.Context, err error) error {
	switch {
	case ctx != nil && ctx.Err() != nil:
		return err
	case errors.Is(err, embed.ErrInvalidRequest), errors.Is(err, embed.ErrOversizedInput):
		return err
	default:
		return Unavailable(err)
	}
}
