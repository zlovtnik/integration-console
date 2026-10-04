import { cleanup, fireEvent, render, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DedupQueue } from '~/components/inventory/DedupQueue';
import {
  resetInventoryFilters,
  setInventoryDedupCandidates,
  setInventoryDedupDevices,
  setInventoryDedupEdges,
  setInventoryDedupLoading,
  setInventoryFilters,
} from '~/stores/inventoryStore';

beforeEach(() => {
  resetInventoryFilters();
  setInventoryDedupLoading(false);
  setInventoryDedupCandidates(
    ['first', 'second'].map((id) => ({
      id: `merge:${id}`,
      kind: 'merge_candidate',
      label: `${id} pair`,
      active: true,
      dedup_confidence: 0.9,
    })),
  );
  setInventoryDedupDevices([
    {
      id: 'device:a',
      kind: 'device',
      label: 'Alice laptop',
      active: true,
      owner_id: 'Alice',
    },
  ]);
  setInventoryDedupEdges([
    {
      id: 'edge',
      source: 'merge:first',
      target: 'device:a',
      kind: 'merge_candidate',
    },
  ]);
});
afterEach(() => {
  cleanup();
  setInventoryDedupCandidates([]);
  setInventoryDedupDevices([]);
  setInventoryDedupEdges([]);
  resetInventoryFilters();
});

describe('bulk identity approval', () => {
  it('previews selection before sending decisions and retains failed pairs for retry', async () => {
    const decision = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const view = render(() => (
      <DedupQueue onSelect={() => {}} onDecision={decision} />
    ));
    fireEvent.click(
      view.getByRole('checkbox', { name: 'Select all visible pairs' }),
    );
    fireEvent.click(
      view.getByRole('button', { name: 'Review selected approvals' }),
    );
    expect(decision).not.toHaveBeenCalled();
    expect(
      view.getByRole('region', { name: 'Selected approval preview' }),
    ).toHaveTextContent('2 identity pairs');
    fireEvent.click(
      view.getByRole('button', { name: 'Approve selected pairs' }),
    );
    await waitFor(() => expect(decision).toHaveBeenCalledTimes(2));
    expect(decision.mock.calls).toEqual([
      ['merge:first', 'merge'],
      ['merge:second', 'merge'],
    ]);
    await waitFor(() =>
      expect(view.getByRole('status')).toHaveTextContent(
        '1 approved, 1 failed',
      ),
    );
    expect(
      view.getByRole('checkbox', { name: 'Select first pair' }),
    ).not.toBeChecked();
    expect(
      view.getByRole('checkbox', { name: 'Select second pair' }),
    ).toBeChecked();
  });

  it('searches device ownership and lets an empty search result be cleared', () => {
    const view = render(() => (
      <DedupQueue onSelect={() => {}} onDecision={() => true} />
    ));
    const search = view.getByRole('searchbox', {
      name: 'Find a device or owner',
    });
    fireEvent.input(search, { target: { value: 'Alice' } });
    expect(
      view.getByRole('checkbox', { name: 'Select first pair' }),
    ).toBeInTheDocument();
    expect(
      view.queryByRole('checkbox', { name: 'Select second pair' }),
    ).toBeNull();
    fireEvent.input(search, { target: { value: 'unmatched' } });
    expect(search).toBeInTheDocument();
    fireEvent.input(search, { target: { value: '' } });
    expect(
      view.getByRole('checkbox', { name: 'Select second pair' }),
    ).toBeInTheDocument();
  });

  it('stops submitting further pairs when the filter scope changes', async () => {
    let finish!: (accepted: boolean) => void;
    const decision = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(() => (
      <DedupQueue onSelect={() => {}} onDecision={decision} />
    ));
    fireEvent.click(
      view.getByRole('checkbox', { name: 'Select all visible pairs' }),
    );
    fireEvent.click(
      view.getByRole('button', { name: 'Review selected approvals' }),
    );
    fireEvent.click(
      view.getByRole('button', { name: 'Approve selected pairs' }),
    );
    setInventoryFilters('owner_ids', ['Other']);
    finish(true);
    await waitFor(() =>
      expect(view.getByRole('status')).toHaveTextContent('1 not submitted'),
    );
    expect(decision).toHaveBeenCalledTimes(1);
  });
});
