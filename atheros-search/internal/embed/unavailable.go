package embed

import (
	"errors"
	"time"
)

// ErrBackendUnavailable identifies failures for which durable worker jobs must
// be deferred instead of consuming a retry attempt.
var ErrBackendUnavailable = errors.New("embedding backend unavailable")

// ErrCapacityExhausted identifies a call that never reached the backend
// because every permitted slot was busy until the caller gave up. It defers
// worker jobs like an outage but keeps its own public fallback code.
var ErrCapacityExhausted = errors.New("embedding capacity exhausted")

// ErrInvalidResponse identifies a backend reply that parsed but is unusable:
// wrong vector counts, wrong dimensions, or an undecodable body. It is a
// backend failure for breaker and deferral purposes, never a job defect.
var ErrInvalidResponse = errors.New("embedding backend returned an invalid response")

type BackendUnavailableError struct {
	RetryAt time.Time
	Cause   error
}

func (err *BackendUnavailableError) Error() string {
	if err.Cause == nil {
		return ErrBackendUnavailable.Error()
	}
	return ErrBackendUnavailable.Error() + ": " + err.Cause.Error()
}
func (err *BackendUnavailableError) Unwrap() error        { return err.Cause }
func (err *BackendUnavailableError) Is(target error) bool { return target == ErrBackendUnavailable }

func RetryTime(err error) (time.Time, bool) {
	var unavailable *BackendUnavailableError
	if errors.As(err, &unavailable) {
		return unavailable.RetryAt, true
	}
	return time.Time{}, false
}

// capacityError wraps a failed slot wait so callers can tell "never tried"
// apart from "tried and the backend failed".
func capacityError(cause error) error {
	if cause == nil {
		cause = ErrCapacityExhausted
	}
	return &BackendUnavailableError{Cause: &capacityCause{cause: cause}}
}

type capacityCause struct{ cause error }

func (err *capacityCause) Error() string {
	return ErrCapacityExhausted.Error() + ": " + err.cause.Error()
}
func (err *capacityCause) Unwrap() error { return err.cause }
func (err *capacityCause) Is(target error) bool {
	return target == ErrCapacityExhausted || errors.Is(err.cause, target)
}
