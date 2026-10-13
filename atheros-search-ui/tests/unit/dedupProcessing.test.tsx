import { cleanup, fireEvent, render, waitFor } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '~/api/client';
import { DedupProcessing } from '~/components/inventory/DedupProcessing';
import { env } from '~/env';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('DQ beta processing', () => {
  it('is disabled by default', () => {
    expect(env.dqBetaEnabled).toBe(false);
  });

  it('submits only an explicit request and separates completion from application', async () => {
    const run = {
      run_id: 'run-1',
      processor_id: 'atheros.dedup',
      processor_version: '0.1.0',
      operation: 'prepare_candidates',
      status: 'succeeded',
      state_revision: 4,
      execution_mode: 'shadow' as const,
      projection_applied: false,
      created_at: '2026-01-01T00:00:00Z',
    };
    const submit = vi.spyOn(api, 'admitDedupRun').mockResolvedValue(run);
    vi.spyOn(api, 'dedupRun').mockResolvedValue(run);
    const view = render(() => <DedupProcessing />);
    expect(submit).not.toHaveBeenCalled();
    fireEvent.input(view.getByLabelText('Approved policy version'), {
      target: { value: 'policy-1' },
    });
    fireEvent.click(view.getByRole('button', { name: 'Prepare candidates' }));
    await waitFor(() =>
      expect(view.getByText(/Run completed/)).toHaveTextContent(
        'Projection application is not confirmed.',
      ),
    );
    expect(submit.mock.calls[0]![0]).toMatchObject({
      operation: 'prepare_candidates',
      authorized_scope: '*',
      policy_version: 'policy-1',
      max_candidates: 100,
    });
    expect(submit.mock.calls[0]![0]).not.toHaveProperty('execution_mode');
  });

  it('preserves idempotency identity when an admission response is lost', async () => {
    const submit = vi
      .spyOn(api, 'admitDedupRun')
      .mockRejectedValue(new Error('Unavailable'));
    const view = render(() => <DedupProcessing />);
    fireEvent.input(view.getByLabelText('Approved policy version'), {
      target: { value: 'policy-1' },
    });
    fireEvent.click(view.getByRole('button', { name: 'Prepare candidates' }));
    await waitFor(() =>
      expect(view.getByRole('alert')).toHaveTextContent('Unavailable'),
    );
    fireEvent.click(view.getByRole('button', { name: 'Prepare candidates' }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(submit.mock.calls[0]![0].idempotency_key).toBe(
      submit.mock.calls[1]![0].idempotency_key,
    );
  });

  it('retains admitted status when polling fails and offers a status retry', async () => {
    const run = {
      run_id: 'run-1',
      processor_id: 'atheros.dedup',
      processor_version: '0.1.0',
      operation: 'prepare_candidates',
      status: 'queued',
      state_revision: 1,
      execution_mode: 'shadow' as const,
      projection_applied: false,
      created_at: '2026-01-01T00:00:00Z',
    };
    vi.spyOn(api, 'admitDedupRun').mockResolvedValue(run);
    vi.spyOn(api, 'dedupRun').mockRejectedValue(new Error('Disconnected'));
    const view = render(() => <DedupProcessing />);
    fireEvent.input(view.getByLabelText('Approved policy version'), {
      target: { value: 'policy-1' },
    });
    fireEvent.click(view.getByRole('button', { name: 'Prepare candidates' }));
    await waitFor(() =>
      expect(view.getByRole('alert')).toHaveTextContent(
        'Run status is unavailable.',
      ),
    );
    expect(view.getByText(/Run run-1/)).toBeInTheDocument();
    expect(
      view.getByRole('button', { name: 'Retry status' }),
    ).toBeInTheDocument();
  });
});
