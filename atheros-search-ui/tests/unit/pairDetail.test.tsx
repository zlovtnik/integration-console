import { render, fireEvent, waitFor, cleanup } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '~/api/client';
import { MergeCandidatePanel } from '~/components/inventory/MergeCandidatePanel';
import { DedupQueue } from '~/components/inventory/DedupQueue';
import {
  setInventoryError,
  setInventoryNodes,
  setInventoryEdges,
} from '~/stores/inventoryStore';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setInventoryError(null);
});

describe('independent pair review', () => {
  it('loads both identities and evidence without map nodes', async () => {
    setInventoryNodes([]);
    setInventoryEdges([]);
    vi.spyOn(api, 'pairDetail').mockResolvedValue({
      candidate_id: 'pair',
      mac_a: 'a',
      mac_b: 'b',
      confidence: 0.8,
      computed_at: '2026-09-01',
      status: 'pending',
      projection_run_id: 'run',
      evidence: { method: 'fingerprint' },
      devices: [
        { id: 'device:a', kind: 'device', label: 'Identifier A', active: true },
        { id: 'device:b', kind: 'device', label: 'Identifier B', active: true },
      ],
    });
    const { getByText } = render(() => (
      <MergeCandidatePanel
        node={{
          id: 'merge:pair',
          kind: 'merge_candidate',
          label: 'Pair',
          active: true,
        }}
        onClose={() => {}}
        onDecision={() => {}}
      />
    ));
    await waitFor(() => {
      getByText('Identifier A');
      getByText('Identifier B');
    });
    expect(api.pairDetail).toHaveBeenCalledWith(
      'pair',
      expect.any(AbortSignal),
    );
  });
  it('makes failed final decisions visible within the queue', () => {
    const { getByRole } = render(() => (
      <DedupQueue onSelect={() => {}} onDecision={() => {}} />
    ));
    setInventoryError('Decision request failed');
    expect(getByRole('alert')).toHaveTextContent('Decision request failed');
    expect(getByRole('alert')).toHaveTextContent('Evidence is retained');
  });
  it('retries unavailable pair evidence', async () => {
    const fetch = vi
      .spyOn(api, 'pairDetail')
      .mockRejectedValue(new Error('unavailable'));
    const { getByText, getByRole } = render(() => (
      <MergeCandidatePanel
        node={{
          id: 'merge:pair',
          kind: 'merge_candidate',
          label: 'Pair',
          active: true,
        }}
        onClose={() => {}}
        onDecision={() => {}}
      />
    ));
    await waitFor(() =>
      expect(getByRole('alert')).toHaveTextContent('Pair evidence unavailable'),
    );
    fireEvent.click(getByText('Retry evidence'));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });
});
