package embed

import (
	"context"
	"sync"
	"time"
)

// Lane separates interactive query embedding from bulk worker embedding while
// both share one transport and one global backend-slot budget.
type Lane string

const (
	LaneInteractive Lane = "interactive"
	LaneWorker      Lane = "worker"
)

// Lanes is the bounded set of scheduler lanes used for metrics labels.
var Lanes = []Lane{LaneInteractive, LaneWorker}

// DefaultQueryReservedSlots is how many global backend slots are never
// available to bulk workers, so an interactive query always finds an idle
// slot even while the embedding backlog is running wide open.
const DefaultQueryReservedSlots = 1

type laneContextKey struct{}

// WithLane marks ctx with the lane the embedding call belongs to. The shared
// HTTP transport reads it to pick the right admission rules.
func WithLane(ctx context.Context, lane Lane) context.Context {
	if lane != LaneWorker {
		lane = LaneInteractive
	}
	return context.WithValue(ctx, laneContextKey{}, lane)
}

// LaneFromContext reports the lane for ctx, defaulting to interactive so
// probes and unannotated callers never take the worker-only reservation.
func LaneFromContext(ctx context.Context) Lane {
	if ctx != nil {
		if lane, ok := ctx.Value(laneContextKey{}).(Lane); ok && lane != "" {
			return lane
		}
	}
	return LaneInteractive
}

// Scheduler is the single admission point for backend embedding requests. The
// global channel bounds total in-flight requests to the backend slot count;
// the worker channel additionally caps bulk workers below that total so the
// reserved slots stay free for interactive queries and health probes.
type Scheduler struct {
	total     int
	reserved  int
	workerMax int

	slots       chan struct{}
	workerSlots chan struct{}

	mu      sync.Mutex
	inUse   map[Lane]int
	waiters map[Lane]int
	waitFn  func(lane Lane, waited time.Duration, canceled bool)
}

// NewScheduler builds a scheduler for total backend slots with reserved slots
// held back from bulk workers. Values are clamped into a usable range instead
// of failing so a misconfigured deployment still serves keyword search.
func NewScheduler(total, reserved int) *Scheduler {
	if total < 1 {
		total = 1
	}
	if reserved < 0 {
		reserved = 0
	}
	if reserved >= total {
		reserved = total - 1
	}
	return &Scheduler{
		total:       total,
		reserved:    reserved,
		workerMax:   total - reserved,
		slots:       make(chan struct{}, total),
		workerSlots: make(chan struct{}, total-reserved),
		inUse:       make(map[Lane]int, len(Lanes)),
		waiters:     make(map[Lane]int, len(Lanes)),
	}
}

// Total is the global backend-slot limit.
func (s *Scheduler) Total() int { return s.total }

// Reserved is the slot count never granted to bulk workers.
func (s *Scheduler) Reserved() int { return s.reserved }

// WorkerMax is the concurrent-request cap for bulk workers.
func (s *Scheduler) WorkerMax() int { return s.workerMax }

// SetWaitObserver registers the callback invoked whenever a lane finishes
// waiting for a slot. It is used for metrics and must not block.
func (s *Scheduler) SetWaitObserver(fn func(lane Lane, waited time.Duration, canceled bool)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.waitFn = fn
}

// InUse reports how many slots a lane currently holds.
func (s *Scheduler) InUse(lane Lane) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.inUse[lane]
}

// Waiting reports how many callers of a lane are queued for a slot.
func (s *Scheduler) Waiting(lane Lane) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.waiters[lane]
}

// Acquire reserves one backend slot for lane and returns the release func.
// Cancellation while waiting returns ctx.Err() without holding any permit, so
// a canceled caller can never leak capacity from another lane.
func (s *Scheduler) Acquire(ctx context.Context, lane Lane) (func(), error) {
	if lane != LaneWorker {
		lane = LaneInteractive
	}
	started := time.Now()
	s.beginWait(lane)
	if lane == LaneWorker {
		select {
		case s.workerSlots <- struct{}{}:
		case <-ctx.Done():
			s.endWait(lane, time.Since(started), true)
			return nil, ctx.Err()
		}
	}
	select {
	case s.slots <- struct{}{}:
		s.endWait(lane, time.Since(started), false)
		return s.releaser(lane), nil
	case <-ctx.Done():
		if lane == LaneWorker {
			<-s.workerSlots
		}
		s.endWait(lane, time.Since(started), true)
		return nil, ctx.Err()
	}
}

func (s *Scheduler) releaser(lane Lane) func() {
	var once sync.Once
	return func() {
		once.Do(func() {
			<-s.slots
			if lane == LaneWorker {
				<-s.workerSlots
			}
			s.mu.Lock()
			if s.inUse[lane] > 0 {
				s.inUse[lane]--
			}
			s.mu.Unlock()
		})
	}
}

func (s *Scheduler) beginWait(lane Lane) {
	s.mu.Lock()
	s.waiters[lane]++
	s.mu.Unlock()
}

func (s *Scheduler) endWait(lane Lane, waited time.Duration, canceled bool) {
	s.mu.Lock()
	if s.waiters[lane] > 0 {
		s.waiters[lane]--
	}
	if !canceled {
		s.inUse[lane]++
	}
	fn := s.waitFn
	s.mu.Unlock()
	if fn != nil {
		fn(lane, waited, canceled)
	}
}
