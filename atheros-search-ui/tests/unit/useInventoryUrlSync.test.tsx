import { MemoryRouter, Route, createMemoryHistory } from '@solidjs/router';
import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { reconcile } from 'solid-js/store';
import { useInventoryUrlSync } from '~/hooks/useInventoryUrlSync';
import {
  inventoryMacQuery,
  inventoryRenderMode,
  setInventoryFilters,
  setInventoryMacQuery,
  setInventoryRenderMode,
  setInventoryViewMode,
} from '~/stores/inventoryStore';

function Probe() {
  const { ready } = useInventoryUrlSync();
  return <span data-testid="ready">{ready() ? 'ready' : 'pending'}</span>;
}

function queryParams(path: string): URLSearchParams {
  return new URLSearchParams(path.split('?')[1] ?? '');
}

describe('useInventoryUrlSync', () => {
  afterEach(() => {
    cleanup();
    setInventoryFilters(
      reconcile({
        grouping: 'registry',
        limit: 400,
        min_dedup_confidence: 0.75,
      }),
    );
    setInventoryViewMode('graph');
    setInventoryRenderMode('2d');
    setInventoryMacQuery('');
  });

  it('reads and writes MAC and 3D render mode query params', async () => {
    const history = createMemoryHistory();
    history.set({
      value: '/inventory?mac=AA:BB:CC:DD:EE:FF&render=3d',
      replace: true,
    });

    render(() => (
      <MemoryRouter history={history}>
        <Route path="/inventory" component={Probe} />
      </MemoryRouter>
    ));

    await waitFor(() => expect(inventoryMacQuery()).toBe('AA:BB:CC:DD:EE:FF'));
    expect(inventoryRenderMode()).toBe('3d');

    setInventoryMacQuery('11:22:33:44:55:66');
    setInventoryRenderMode('2d');

    await waitFor(() => {
      const params = queryParams(history.get());
      expect(params.get('mac')).toBe('11:22:33:44:55:66');
      expect(params.get('render')).toBeNull();
    });
  });
});
