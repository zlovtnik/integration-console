import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import { api } from '~/api/client';
import { clearAuditState, setAuditIdentity } from '~/auth/auditState';
import { pipeline, setPipeline } from '~/stores/operationsStore';
import { usePipeline } from '~/hooks/useOperations';
import IngestionPage from '~/pages/IngestionPage';
import { measurement } from '~/components/OperationsStatus';
import { pipelineFixture } from '../fixtures/operations';

vi.mock('~/auth/session', () => ({
  getAccessToken: vi.fn(async () => 'token'),
  denyAuditAccess: vi.fn(),
  authStatus: () => 'authenticated',
}));

describe('operational measurements', () => {
  beforeEach(() => {
    setAuditIdentity('A');
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    clearAuditState();
  });

  it('preserves the distinction between unknown and zero', () => {
    expect(measurement(null)).toBe('Unknown');
    expect(measurement(undefined)).toBe('Unknown');
    expect(measurement(0)).toBe('0');
  });

  it('shows failure, stale and missing measurements without claiming readiness', () => {
    setPipeline({
      ...pipelineFixture,
      status: 'stale',
      stages: [
        {
          ...pipelineFixture.stages[0]!,
          status: 'failed',
          pending: null,
          failed: 2,
        },
      ],
      embedding: { ...pipelineFixture.embedding, dependency: 'blocked' },
    });
    render(() => <IngestionPage />);
    expect(screen.getAllByText('stale').length).toBeGreaterThan(0);
    expect(screen.getByText('failed')).toBeInTheDocument();
    expect(screen.getByText('blocked')).toBeInTheDocument();
    expect(screen.getAllByText('Unknown').length).toBeGreaterThan(0);
    expect(
      screen.getByText(/History is not a live reading/),
    ).toBeInTheDocument();
  });

  it('labels live and peak freshness independently and preserves missing measurements', () => {
    setPipeline({
      ...pipelineFixture,
      history: {
        ...pipelineFixture.history,
        status: 'stale',
        peaks_status: 'current',
        live_strip: null,
      },
    });
    render(() => <IngestionPage />);
    expect(screen.getByText('stale')).toBeInTheDocument();
    expect(screen.getAllByText('current').length).toBeGreaterThan(0);
    expect(screen.getByText(/180 seconds/)).toBeInTheDocument();
    expect(screen.getByText(/360 seconds/)).toBeInTheDocument();
    expect(screen.getAllByText('Unknown').length).toBeGreaterThan(0);
  });

  it('clears the shared pipeline snapshot on identity change', () => {
    setPipeline(pipelineFixture);
    setAuditIdentity('B');
    expect(pipeline()).toBeUndefined();
  });

  it('aborts pending work and rejects late results from the previous identity', async () => {
    let finish!: (value: typeof pipelineFixture) => void;
    let oldSignal: AbortSignal | undefined;
    vi.spyOn(api, 'operationsPipeline')
      .mockImplementationOnce((signal) => {
        oldSignal = signal;
        return new Promise((resolve) => {
          finish = resolve;
        });
      })
      .mockResolvedValue({ ...pipelineFixture, status: 'unavailable' });
    render(() => {
      usePipeline();
      return <span>poller</span>;
    });
    await waitFor(() =>
      expect(api.operationsPipeline).toHaveBeenCalledTimes(1),
    );
    setAuditIdentity('B');
    expect(oldSignal?.aborted).toBe(true);
    finish(pipelineFixture);
    await waitFor(() => expect(pipeline()?.status).toBe('unavailable'));
  });

  it('keeps viewer denial local to live telemetry', async () => {
    const denied = vi.fn();
    const session = await import('~/auth/session');
    vi.mocked(session.denyAuditAccess).mockImplementation(denied);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"message":"forbidden"}', { status: 403 }),
    );
    await expect(api.proxyLive()).rejects.toMatchObject({ status: 403 });
    expect(denied).not.toHaveBeenCalled();
  });

  it.each(['identity change', 'caller cancellation', 'timeout'])(
    'cancels an unfinished response body after headers on %s',
    async (reason) => {
      if (reason === 'timeout') vi.useFakeTimers();
      let bodySignal: AbortSignal | undefined;
      let started!: () => void;
      const reading = new Promise<void>((resolve) => {
        started = resolve;
      });
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
        bodySignal = init?.signal ?? undefined;
        const response = new Response('{}');
        vi.spyOn(response, 'json').mockImplementation(
          () =>
            new Promise((_resolve, reject) => {
              bodySignal?.addEventListener(
                'abort',
                () => reject(new DOMException('Aborted', 'AbortError')),
                { once: true },
              );
              started();
            }),
        );
        return response;
      });
      const caller = new AbortController();
      const pending = api.operationsPipeline(caller.signal);
      const rejected = expect(pending).rejects.toMatchObject({
        name: 'AbortError',
      });
      await reading;
      expect(bodySignal?.aborted).toBe(false);
      if (reason === 'identity change') clearAuditState();
      else if (reason === 'caller cancellation') caller.abort();
      else await vi.advanceTimersByTimeAsync(5000);
      expect(bodySignal?.aborted).toBe(true);
      await rejected;
    },
  );
});
