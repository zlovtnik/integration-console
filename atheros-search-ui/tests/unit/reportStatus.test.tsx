import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '~/api/client';
import type { ETLHealth } from '~/api/types';
import { ReportStatus } from '~/components/ReportStatus';

vi.mock('@solidjs/router', () => ({
  useSearchParams: () => [{}],
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const healthy: ETLHealth = {
  measured_at: '2026-09-27T12:00:00Z',
  wireless_events_24h: 12,
  wireless_last_observed_at: '2026-09-27T11:59:00Z',
  wireless_projection: 'fresh',
  ingest_pending: 1,
  ingest_processing: 0,
  ingest_failed: 0,
  embedding_pending: 2,
  embedding_failed: 0,
  embedding_dependency: 'healthy',
  query_semantic: {
    preflight: 'compatible',
    circuit_state: 'closed',
    backend_available: true,
    last_check_at: '2026-09-27T12:00:00Z',
  },
  worker_semantic: {
    preflight: 'incompatible',
    circuit_state: 'open',
    backend_available: false,
    last_check_at: '2026-09-27T12:00:00Z',
    retry_at: '2026-09-27T12:10:00Z',
  },
};

describe('ReportStatus pipeline status', () => {
  it('reports the wireless projection and per-lane semantic health', async () => {
    vi.spyOn(api, 'etlHealth').mockResolvedValue(healthy);

    const { findByText } = render(() => (
      <ReportStatus generatedAt="2026-09-27T12:00:00Z" />
    ));

    await findByText(/Pipeline health/);
    await findByText(
      /12 wireless events indexed in the last 24h.*\(projection fresh\)/,
    );
    await findByText(
      'Semantic search: query lane compatible, closed, available · worker lane incompatible, open, unavailable.',
    );
  });

  it('omits the semantic paragraph when the server sends no lane health', async () => {
    const {
      query_semantic: _query,
      worker_semantic: _worker,
      ...bare
    } = healthy;
    vi.spyOn(api, 'etlHealth').mockResolvedValue(bare);

    const { findByText, queryByText } = render(() => (
      <ReportStatus generatedAt="2026-09-27T12:00:00Z" />
    ));

    await findByText(/Pipeline health/);
    await waitFor(() => {
      expect(queryByText(/Semantic search:/)).toBeNull();
    });
  });
});
