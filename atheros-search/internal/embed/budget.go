package embed

import (
	"errors"
	"fmt"
)

// ErrOversizedInput marks a source whose chunk count is above the configured
// per-input budget. It is a durable job outcome, not a backend failure: the
// circuit breaker must not count it and the worker must not defer on it.
var ErrOversizedInput = errors.New("embedding source exceeds chunk budget")

var errChunkBudget = errors.New("embedding source chunk budget exceeded")

// OversizedInputError identifies which input in an Embed batch is above the
// chunk budget, so the worker can fail exactly that job and keep the rest of
// the batch.
type OversizedInputError struct {
	Index int
	Cause error
}

func (err *OversizedInputError) Error() string {
	if err.Cause == nil {
		return ErrOversizedInput.Error()
	}
	return fmt.Sprintf("%s: %v", ErrOversizedInput, err.Cause)
}

func (err *OversizedInputError) Unwrap() error { return err.Cause }

func (err *OversizedInputError) Is(target error) bool {
	if target == ErrOversizedInput {
		return true
	}
	return errors.Is(err.Cause, target)
}
