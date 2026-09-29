package embed

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"
)

type CircuitState string

const (
	CircuitClosed   CircuitState = "closed"
	CircuitOpen     CircuitState = "open"
	CircuitHalfOpen CircuitState = "half_open"
)

const (
	// DefaultCircuitFailureMax is consecutive counted failures before the
	// breaker opens.
	DefaultCircuitFailureMax = 3
	// DefaultCircuitBaseBackoff is the first reopen delay after a trip.
	DefaultCircuitBaseBackoff = 10 * time.Second
	// DefaultCircuitMaxBackoff bounds the exponential reopen delay.
	DefaultCircuitMaxBackoff = 2 * time.Minute
)

// CircuitSnapshot is the read-only view published to health and metrics.
type CircuitSnapshot struct {
	State         CircuitState
	Failures      int
	RetryAt       time.Time
	LastCheckAt   time.Time
	LastSuccessAt time.Time
	LastFailureAt time.Time
}

// Circuit is one lane's breaker. Interactive queries and bulk workers each get
// their own instance while sharing the scheduler and the HTTP transport, so a
// hot backlog cannot open the breaker that guards interactive search.
type Circuit struct {
	FailureMax  int
	BaseBackoff time.Duration
	MaxBackoff  time.Duration

	// now is overridable so backoff and probe tests stay deterministic.
	now func() time.Time

	mu          sync.Mutex
	state       CircuitState
	failures    int
	backoff     time.Duration
	openedUntil time.Time
	probing     bool
	lastCheckAt time.Time
	lastSuccess time.Time
	lastFailure time.Time
}

// NewCircuit builds a closed breaker with the production backoff bounds.
func NewCircuit() *Circuit {
	return &Circuit{
		FailureMax:  DefaultCircuitFailureMax,
		BaseBackoff: DefaultCircuitBaseBackoff,
		MaxBackoff:  DefaultCircuitMaxBackoff,
		now:         time.Now,
		state:       CircuitClosed,
	}
}

func (c *Circuit) clock() time.Time {
	if c.now != nil {
		return c.now()
	}
	return time.Now()
}

// State reports the current breaker state, letting an elapsed open window
// advance the breaker to half-open.
func (c *Circuit) State() CircuitState {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.advanceLocked()
	return c.state
}

// Snapshot returns the published breaker view.
func (c *Circuit) Snapshot() CircuitSnapshot {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.advanceLocked()
	return CircuitSnapshot{
		State:         c.state,
		Failures:      c.failures,
		RetryAt:       c.retryAtLocked(),
		LastCheckAt:   c.lastCheckAt,
		LastSuccessAt: c.lastSuccess,
		LastFailureAt: c.lastFailure,
	}
}

// admit decides whether a call may reach the backend. It returns the retry
// time when the call is rejected, whether the call was admitted, and whether
// the admitted call is the single half-open probe.
func (c *Circuit) admit() (retryAt time.Time, admitted bool, probe bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.advanceLocked()
	switch c.state {
	case CircuitOpen:
		return c.openedUntil, false, false
	case CircuitHalfOpen:
		if c.probing {
			return c.openedUntil, false, false
		}
		c.probing = true
		return time.Time{}, true, true
	default:
		return time.Time{}, true, false
	}
}

// markCheck records that a call is being attempted against the backend.
func (c *Circuit) markCheck() {
	c.mu.Lock()
	c.lastCheckAt = c.clock()
	c.mu.Unlock()
}

// record classifies the outcome of an admitted call. Only failures that are
// attributable to the backend count: caller cancellation, shutdown, capacity
// waits, oversized inputs and request validation are neutral. It reports
// whether the outcome was neutral, leaving a half-open probe slot held that the
// caller must release with releaseProbe.
func (c *Circuit) record(ctx context.Context, err error) (neutral bool) {
	if err == nil {
		c.mu.Lock()
		c.lastCheckAt = c.clock()
		c.lastSuccess = c.lastCheckAt
		c.failures = 0
		c.backoff = 0
		c.state = CircuitClosed
		c.probing = false
		c.openedUntil = time.Time{}
		c.mu.Unlock()
		return false
	}
	if !IsCircuitFailure(ctx, err) {
		return true
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	now := c.clock()
	c.lastCheckAt = now
	c.lastFailure = now
	c.failures++
	if c.state == CircuitHalfOpen || c.failures >= c.failureMaxLocked() {
		c.state = CircuitOpen
		c.probing = false
		if c.backoff <= 0 {
			c.backoff = c.baseBackoffLocked()
		}
		c.openedUntil = now.Add(c.backoff)
		c.backoff = c.nextBackoffLocked()
	}
	return false
}

// releaseProbe hands the single half-open probe slot back to the breaker after
// a neutral outcome, which neither closes nor reopens it. It is a no-op unless
// the breaker is still half-open, so a probe that already transitioned the
// breaker keeps its own outcome and a call made in the closed state changes
// nothing.
func (c *Circuit) releaseProbe() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.state == CircuitHalfOpen {
		c.probing = false
	}
}

// advanceLocked moves an elapsed open window into half-open.
func (c *Circuit) advanceLocked() {
	if c.state == CircuitOpen && !c.openedUntil.IsZero() && !c.clock().Before(c.openedUntil) {
		c.state = CircuitHalfOpen
		c.probing = false
	}
}

func (c *Circuit) retryAtLocked() time.Time {
	if c.state == CircuitOpen {
		return c.openedUntil
	}
	return time.Time{}
}

func (c *Circuit) failureMaxLocked() int {
	if c.FailureMax > 0 {
		return c.FailureMax
	}
	return DefaultCircuitFailureMax
}

func (c *Circuit) baseBackoffLocked() time.Duration {
	if c.BaseBackoff > 0 {
		return c.BaseBackoff
	}
	return DefaultCircuitBaseBackoff
}

func (c *Circuit) nextBackoffLocked() time.Duration {
	base := c.baseBackoffLocked()
	max := c.MaxBackoff
	if max <= 0 {
		max = DefaultCircuitMaxBackoff
	}
	if max < base {
		max = base
	}
	next := c.backoff * 2
	if next <= base {
		next = base * 2
	}
	if next > max {
		next = max
	}
	return next
}

// IsCircuitFailure reports whether err is a backend-attributable failure.
// Transport failures, backend deadlines, HTTP 429/5xx responses and invalid
// embedding responses count. Caller cancellation, shutdown, capacity-wait
// cancellation, oversized inputs and request-validation errors do not.
func IsCircuitFailure(ctx context.Context, err error) bool {
	if err == nil {
		return false
	}
	switch {
	case errors.Is(err, ErrOversizedInput):
		return false
	case errors.Is(err, ErrInvalidRequest):
		return false
	case errors.Is(err, ErrCircuitOpen):
		return false
	case errors.Is(err, context.Canceled):
		return false
	}
	// A caller deadline or shutdown cancels the in-flight request before the
	// backend can be blamed, so only a live caller context counts failures.
	if ctx != nil && ctx.Err() != nil {
		return false
	}
	return true
}

// LaneClient binds one lane's breaker to the shared transport. It tags every
// call with the lane so the scheduler applies the right admission rules.
type LaneClient struct {
	Inner   Client
	Lane    Lane
	Circuit *Circuit
}

// NewLaneClient wraps inner with lane's breaker.
func NewLaneClient(inner Client, lane Lane) *LaneClient {
	return &LaneClient{Inner: inner, Lane: lane, Circuit: NewCircuit()}
}

// State reports the lane breaker state.
func (c *LaneClient) State() CircuitState {
	if c.Circuit == nil {
		return CircuitClosed
	}
	return c.Circuit.State()
}

// Snapshot reports the lane breaker view.
func (c *LaneClient) Snapshot() CircuitSnapshot {
	if c.Circuit == nil {
		return CircuitSnapshot{State: CircuitClosed}
	}
	return c.Circuit.Snapshot()
}

func (c *LaneClient) Embed(ctx context.Context, texts []string, kind Kind) ([][]float32, error) {
	return c.call(WithLane(ctx, c.Lane), func(ctx context.Context) ([][]float32, error) {
		return c.Inner.Embed(ctx, texts, kind)
	})
}

func (c *LaneClient) Health(ctx context.Context) error {
	_, err := c.call(WithLane(ctx, c.Lane), func(ctx context.Context) ([][]float32, error) {
		return nil, c.Inner.Health(ctx)
	})
	return err
}

func (c *LaneClient) call(ctx context.Context, fn func(context.Context) ([][]float32, error)) ([][]float32, error) {
	if c.Circuit == nil {
		return fn(ctx)
	}
	retryAt, admitted, _ := c.Circuit.admit()
	if !admitted {
		return nil, &BackendUnavailableError{RetryAt: retryAt, Cause: ErrCircuitOpen}
	}
	c.Circuit.markCheck()
	vectors, err := fn(ctx)
	if c.Circuit.record(ctx, err) {
		c.Circuit.releaseProbe()
	}
	if err != nil {
		return nil, err
	}
	return vectors, nil
}

// ErrCircuitOpen marks a call rejected before it reached the backend because
// this lane's breaker was open. It is never counted as a new failure.
var ErrCircuitOpen = errors.New("embedding circuit open")

// ErrInvalidRequest marks caller-side request validation failures. They are
// permanent for the request that produced them and must not move a breaker.
var ErrInvalidRequest = errors.New("embedding request rejected")

func invalidRequest(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrInvalidRequest, fmt.Sprintf(format, args...))
}
