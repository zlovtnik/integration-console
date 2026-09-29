package embed

import (
	"context"
	"sync"
	"time"
)

// PreflightState is the published outcome of the background semantic
// preflight that proves the llama.cpp tokenizer endpoints are compatible.
type PreflightState string

const (
	// PreflightPending means no check has completed yet.
	PreflightPending PreflightState = "pending"
	// PreflightCompatible means the tokenizer round trip succeeded, so
	// workers may claim durable jobs.
	PreflightCompatible PreflightState = "compatible"
	// PreflightIncompatible means the last check failed, so workers must
	// defer claims until a later check succeeds.
	PreflightIncompatible PreflightState = "incompatible"
	// PreflightDisabled means no embedding backend is configured.
	PreflightDisabled PreflightState = "disabled"
)

const (
	// PreflightCheckTimeout bounds one tokenizer validation round trip.
	PreflightCheckTimeout = 15 * time.Second
	// PreflightRetryInterval is the delay before the first retry.
	PreflightRetryInterval = 5 * time.Second
	// PreflightMaxRetryInterval bounds the failure backoff.
	PreflightMaxRetryInterval = time.Minute
	// PreflightSuccessInterval is how often a healthy backend is re-verified.
	PreflightSuccessInterval = time.Minute
)

// PreflightSnapshot is the published preflight view.
type PreflightSnapshot struct {
	State         PreflightState
	LastCheckAt   time.Time
	LastSuccessAt time.Time
}

// Preflight replaces the old fatal startup tokenizer validation with a
// background gate: the API starts immediately (keyword search works), while
// workers stay out of the claim queue until compatibility is proven.
type Preflight struct {
	check func(context.Context) error

	mu            sync.Mutex
	state         PreflightState
	lastCheckAt   time.Time
	lastSuccessAt time.Time
	checkInterval time.Duration
	successEvery  time.Duration
	maxInterval   time.Duration
	nextDelay     time.Duration
	now           func() time.Time
	onTransition  func(PreflightState)
}

// NewPreflight builds a pending gate around check. A nil check reports the
// disabled state so an unconfigured backend never blocks anything.
func NewPreflight(check func(context.Context) error) *Preflight {
	p := &Preflight{
		check:         check,
		state:         PreflightPending,
		checkInterval: PreflightRetryInterval,
		successEvery:  PreflightSuccessInterval,
		maxInterval:   PreflightMaxRetryInterval,
		nextDelay:     0,
		now:           time.Now,
	}
	if check == nil {
		p.state = PreflightDisabled
	}
	return p
}

// SetTransitionObserver registers a callback fired whenever the published
// state changes. It is used for metrics and must not block.
func (p *Preflight) SetTransitionObserver(fn func(PreflightState)) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.onTransition = fn
}

// Ready reports whether workers may claim durable jobs.
func (p *Preflight) Ready() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.state == PreflightCompatible
}

// Snapshot returns the published preflight view.
func (p *Preflight) Snapshot() PreflightSnapshot {
	p.mu.Lock()
	defer p.mu.Unlock()
	return PreflightSnapshot{
		State:         p.state,
		LastCheckAt:   p.lastCheckAt,
		LastSuccessAt: p.lastSuccessAt,
	}
}

// Run performs checks until ctx is canceled. The first iteration runs
// immediately so a healthy backend opens the gate without a startup delay.
func (p *Preflight) Run(ctx context.Context) {
	if p == nil || p.check == nil {
		return
	}
	for {
		p.runOnce(ctx)
		delay := p.nextSleep()
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
}

// CheckNow runs one validation immediately and returns whether it succeeded.
func (p *Preflight) CheckNow(ctx context.Context) bool {
	return p.runOnce(ctx)
}

func (p *Preflight) runOnce(parent context.Context) bool {
	checkCtx, cancel := context.WithTimeout(parent, PreflightCheckTimeout)
	err := p.check(checkCtx)
	cancel()

	p.mu.Lock()
	p.lastCheckAt = p.now()
	previous := p.state
	if err == nil {
		p.lastSuccessAt = p.lastCheckAt
		p.state = PreflightCompatible
		p.nextDelay = p.successInterval()
	} else {
		p.state = PreflightIncompatible
		p.nextDelay = p.nextBackoffLocked()
	}
	observer := p.onTransition
	changed := previous != p.state
	p.mu.Unlock()
	if changed && observer != nil {
		observer(p.state)
	}
	return err == nil
}

// nextSleep reports how long to wait before the next check.
func (p *Preflight) nextSleep() time.Duration {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.state == PreflightCompatible {
		return p.successInterval()
	}
	return p.nextDelay
}

func (p *Preflight) successInterval() time.Duration {
	if p.successEvery > 0 {
		return p.successEvery
	}
	return PreflightSuccessInterval
}

func (p *Preflight) nextBackoffLocked() time.Duration {
	base := p.checkInterval
	if base <= 0 {
		base = PreflightRetryInterval
	}
	max := p.maxInterval
	if max <= 0 {
		max = PreflightMaxRetryInterval
	}
	if max < base {
		max = base
	}
	if p.nextDelay < base {
		return base
	}
	next := p.nextDelay * 2
	if next > max {
		next = max
	}
	return next
}
