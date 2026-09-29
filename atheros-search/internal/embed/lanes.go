package embed

import (
	"context"
	"errors"
)

// ErrNoLanes is returned when a LanedClient is used without any lane bound.
var ErrNoLanes = errors.New("embedding lanes are not configured")

// LanedClient dispatches each embedding call to the lane the caller declared
// on the context. One value can therefore serve interactive queries, bulk
// workers and readiness probes while each lane keeps its own breaker and all
// three share one transport and one scheduler.
type LanedClient struct {
	Interactive *LaneClient
	Worker      *LaneClient
}

// NewLanedClient builds both lanes around inner.
func NewLanedClient(inner Client) *LanedClient {
	return &LanedClient{
		Interactive: NewLaneClient(inner, LaneInteractive),
		Worker:      NewLaneClient(inner, LaneWorker),
	}
}

// Lane returns the breaker-bound client for lane, falling back to the
// interactive lane for anything that is not the worker lane.
func (c *LanedClient) Lane(lane Lane) *LaneClient {
	if c == nil {
		return nil
	}
	if lane == LaneWorker && c.Worker != nil {
		return c.Worker
	}
	return c.Interactive
}

func (c *LanedClient) Embed(ctx context.Context, texts []string, kind Kind) ([][]float32, error) {
	client := c.Lane(LaneFromContext(ctx))
	if client == nil {
		return nil, ErrNoLanes
	}
	return client.Embed(ctx, texts, kind)
}

// Health probes the interactive lane: readiness checks must never take a
// worker reservation or be rejected by a bulk backlog that opened the worker
// breaker.
func (c *LanedClient) Health(ctx context.Context) error {
	client := c.Lane(LaneInteractive)
	if client == nil {
		return ErrNoLanes
	}
	return client.Health(ctx)
}
