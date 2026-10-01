// Package apperror defines transport-independent errors for control flow.
package apperror

import (
	"errors"
	"fmt"
	"time"
)

var (
	ErrValidation  = errors.New("validation")
	ErrNotFound    = errors.New("not found")
	ErrConflict    = errors.New("conflict")
	ErrForbidden   = errors.New("forbidden")
	ErrUnavailable = errors.New("unavailable")
)

type Error struct {
	Kind    error
	Message string
}

func (e *Error) Error() string             { return e.Message }
func (e *Error) Unwrap() error             { return e.Kind }
func New(kind error, message string) error { return &Error{Kind: kind, Message: message} }
func Validationf(format string, args ...any) error {
	return New(ErrValidation, fmt.Sprintf(format, args...))
}

type UnavailableError struct {
	Code    string
	RetryAt time.Time
	Message string
}

func (e *UnavailableError) Error() string {
	message := e.Message
	if message == "" {
		message = "semantic backend unavailable"
	}
	if e.Code == "" {
		return message
	}
	return fmt.Sprintf("%s (code=%s)", message, e.Code)
}
func (e *UnavailableError) Is(target error) bool { return target == ErrUnavailable }
