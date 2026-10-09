package embed

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestSchedulerReservesSlotsForInteractiveQueries(t *testing.T) {
	scheduler := NewScheduler(4, 1)
	require.Equal(t, 4, scheduler.Total())
	require.Equal(t, 1, scheduler.Reserved())
	require.Equal(t, 3, scheduler.WorkerMax())

	releases := make([]func(), 0, scheduler.WorkerMax())
	for i := 0; i < scheduler.WorkerMax(); i++ {
		release, err := scheduler.Acquire(context.Background(), LaneWorker)
		require.NoError(t, err)
		releases = append(releases, release)
	}

	blockedCtx, cancel := context.WithTimeout(context.Background(), 25*time.Millisecond)
	defer cancel()
	_, err := scheduler.Acquire(blockedCtx, LaneWorker)
	require.ErrorIs(t, err, context.DeadlineExceeded)

	// The slot the workers cannot touch must still be available to a query.
	release, err := scheduler.Acquire(context.Background(), LaneInteractive)
	require.NoError(t, err)
	require.Equal(t, 1, scheduler.InUse(LaneInteractive))
	release()

	for _, release := range releases {
		release()
	}
	require.Zero(t, scheduler.InUse(LaneWorker))
}

func TestSchedulerCancellationWhileWaitingHoldsNoPermit(t *testing.T) {
	scheduler := NewScheduler(1, 0)
	release, err := scheduler.Acquire(context.Background(), LaneInteractive)
	require.NoError(t, err)

	waitingCtx, cancel := context.WithTimeout(context.Background(), 25*time.Millisecond)
	defer cancel()
	_, err = scheduler.Acquire(waitingCtx, LaneInteractive)
	require.ErrorIs(t, err, context.DeadlineExceeded)
	require.Equal(t, 1, scheduler.InUse(LaneInteractive), "a canceled waiter must not hold a second slot")
	require.Zero(t, scheduler.Waiting(LaneInteractive), "a canceled waiter must leave the queue")

	release()
	require.Zero(t, scheduler.InUse(LaneInteractive))
	acquiredCtx, cancelAcquire := context.WithTimeout(context.Background(), time.Second)
	defer cancelAcquire()
	releaseAfterCancel, err := scheduler.Acquire(acquiredCtx, LaneInteractive)
	require.NoError(t, err)
	releaseAfterCancel()
}

func TestSchedulerReturnsWorkerPermitWhenGlobalWaitIsCanceled(t *testing.T) {
	scheduler := NewScheduler(1, 0)
	release, err := scheduler.Acquire(context.Background(), LaneInteractive)
	require.NoError(t, err)

	waitingCtx, cancel := context.WithTimeout(context.Background(), 25*time.Millisecond)
	defer cancel()
	_, err = scheduler.Acquire(waitingCtx, LaneWorker)
	require.ErrorIs(t, err, context.DeadlineExceeded)

	release()
	acquiredCtx, cancelAcquire := context.WithTimeout(context.Background(), time.Second)
	defer cancelAcquire()
	releaseWorker, err := scheduler.Acquire(acquiredCtx, LaneWorker)
	require.NoError(t, err, "the worker permit taken before the canceled global wait must have been returned")
	releaseWorker()
	require.Zero(t, scheduler.InUse(LaneWorker))
}

func TestSchedulerReportsSlotWaitsToObserver(t *testing.T) {
	scheduler := NewScheduler(1, 0)
	type observed struct {
		lane     Lane
		waited   time.Duration
		canceled bool
	}
	var events []observed
	scheduler.SetWaitObserver(func(lane Lane, waited time.Duration, canceled bool) {
		events = append(events, observed{lane: lane, waited: waited, canceled: canceled})
	})

	release, err := scheduler.Acquire(context.Background(), LaneWorker)
	require.NoError(t, err)
	defer release()

	waitingCtx, cancel := context.WithCancel(context.Background())
	defer cancel()
	waitingErr := make(chan error, 1)
	go func() {
		releaseWaiting, acquireErr := scheduler.Acquire(waitingCtx, LaneInteractive)
		if releaseWaiting != nil {
			releaseWaiting()
		}
		waitingErr <- acquireErr
	}()

	// Start measuring only once Acquire has entered the queue. A context
	// deadline created before Acquire can include time spent scheduling it.
	require.Eventually(t, func() bool {
		return scheduler.Waiting(LaneInteractive) == 1
	}, time.Second, time.Millisecond)
	waitStarted := time.Now()
	time.Sleep(20 * time.Millisecond)
	minimumWait := time.Since(waitStarted)
	cancel()
	select {
	case err = <-waitingErr:
	case <-time.After(time.Second):
		t.Fatal("queued acquisition did not return after cancellation")
	}
	require.ErrorIs(t, err, context.Canceled)
	require.Zero(t, scheduler.Waiting(LaneInteractive))
	require.Zero(t, scheduler.InUse(LaneInteractive))

	require.Len(t, events, 2)
	require.Equal(t, LaneWorker, events[0].lane)
	require.False(t, events[0].canceled)
	require.Equal(t, LaneInteractive, events[1].lane)
	require.True(t, events[1].canceled)
	require.GreaterOrEqual(t, events[1].waited, minimumWait)
}

func TestSchedulerClampsMisconfiguredReservations(t *testing.T) {
	require.Equal(t, 1, NewScheduler(0, 0).Total())
	require.Equal(t, 0, NewScheduler(4, -1).Reserved())
	require.Equal(t, 0, NewScheduler(1, 5).Reserved())
	require.Equal(t, 1, NewScheduler(1, 5).WorkerMax())
}
