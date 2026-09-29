import { render, screen, waitFor, cleanup } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMemoryHistory,
  MemoryRouter,
  Route,
} from '@solidjs/router';
import { api } from '~/api/client';
import type { RecordContextResponse } from '~/api/types';
import ExplainPage from '~/pages/ExplainPage';

function contextFixture(
  overrides: Partial<RecordContextResponse> = {},
): RecordContextResponse {
  return {
    source_key: 'frame-1',
    found: true,
    window_start: '2026-03-03T09:15:00Z',
    window_end: '2026-03-04T09:16:00Z',
    bucket_minutes: 15,
    generated_at: '2026-03-04T09:16:00Z',
    record: {
      document_id: 'doc-1',
      source_key: 'frame-1',
      source_table: 'wireless_frames',
      source_kind: 'event',
      status: 'active',
      source_mac: 'aa:bb:cc:dd:ee:01',
      bssid: 'aa:bb:cc:dd:ee:ff',
      ssid: 'lab-ssid',
      location_id: 'london-lab',
      sensor_id: 'sensor-north',
      frame_subtype: 'data',
      classification: 'unknown',
      title: 'Data frame',
      producer: 'octopus',
      tags: ['threat:probe'],
      security_flags: 4,
      handshake_captured: true,
      host: '',
      blocked: null,
      proxy_event_type: '',
      proxy_device_id: '',
      observed_at: '2026-03-04T09:15:00Z',
      normalized_sha256: 'abc',
      detail_json: '{"event_type":"data"}',
    },
    activity: [
      {
        window_start: '2026-03-04T09:00:00Z',
        frame_count: 60,
        frames_per_minute: 4,
        sensor_count: 2,
        ap_count: 1,
        rssi_avg_dbm: -55.5,
      },
    ],
    activity_totals: {
      buckets: 1,
      frame_count: 60,
      frames_per_minute: 4,
      peak_frames_per_minute: 4,
      sensor_count: 2,
      ap_count: 1,
    },
    related: {
      anchor_kind: 'device',
      anchor_id: 'aa:bb:cc:dd:ee:01',
      rf_proximity: 'inferred',
      signal_quality: 'sensor-measured RSSI available',
      confidence: 'not a probability',
      neighbours: [
        {
          mac: 'aa:bb:cc:dd:ee:02',
          label: 'phone',
          ap_count: 1,
          window_count: 4,
          sensor_count: 2,
          frame_count: 90,
          rssi_avg_dbm: -61,
          first_observed_at: '2026-03-04T08:00:00Z',
          last_observed_at: '2026-03-04T09:10:00Z',
          corroborated: true,
        },
      ],
      links: [
        {
          type: 'inferred_rf_similarity',
          from: 'device:aa:bb:cc:dd:ee:01',
          to: 'device:aa:bb:cc:dd:ee:02',
          weight: 4,
          weight_basis: 'time_overlap_windows',
          confidence: 'a proximity hint, not a measured distance',
          fresh: true,
          evidence_references: [],
        },
      ],
    },
    embedding: [
      {
        embedding_kind: 'event',
        embedding_model: 'text-embed-v1',
        status: 'completed',
        attempt_count: 1,
        max_attempts: 5,
        last_error: undefined,
        completed_at: '2026-03-04T09:15:00Z',
        embedded_at: '2026-03-04T09:15:00Z',
        content_sha256: 'abc',
        has_vector: true,
        content_current: true,
      },
    ],
    embedding_note: 'content_current compares the job content hash.',
    freshness: { coverage_status: 'complete' },
    ...overrides,
  };
}

function renderPage() {
  const history = createMemoryHistory();
  history.set({
    value: '/explain/frame-1?query=probe&kind=SEARCH_KIND_EVENT',
    replace: true,
  });
  return render(() => (
    <MemoryRouter history={history}>
      <Route path="/explain/:sourceKey" component={ExplainPage} />
    </MemoryRouter>
  ));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('record detail page', () => {
  it('shows the record, activity, related devices and embedding work', async () => {
    vi.spyOn(api, 'explainScoped').mockResolvedValue({
      source_key: 'frame-1',
      dense_score: 0,
      sparse_score: 0.12,
      fused_score: 0,
      threat_boost: 0,
      boost_reasons: [],
      sequence_log_prob: 0,
      scores_available: true,
      found: true,
      source_kind: 'event',
      ranking_method: 'scoped_sparse_direct',
    });
    vi.spyOn(api, 'recordContext').mockResolvedValue(contextFixture());

    renderPage();

    await waitFor(() => screen.getByText('london-lab'));
    expect(screen.getByText('sensor-north')).toBeTruthy();
    expect(screen.getByText('aa:bb:cc:dd:ee:01')).toBeTruthy();

    // Activity: totals, an accessible chart label, and a data table.
    expect(screen.getByText('frames/min')).toBeTruthy();
    expect(
      screen.getByLabelText(/Observed traffic rate across 1 15-minute bucket/),
    ).toBeTruthy();
    const rateCell = screen
      .getAllByRole('cell')
      .find((cell) => cell.textContent === '4');
    expect(rateCell).toBeTruthy();

    // Related devices and the derived relationship.
    expect(screen.getByText('across 2 sensors')).toBeTruthy();
    expect(screen.getByText('90 frames')).toBeTruthy();
    expect(screen.getByText('corroborated by multiple sensors')).toBeTruthy();
    expect(screen.getByText('RF proximity')).toBeTruthy();
    expect(
      screen.getByText(
        'aa:bb:cc:dd:ee:01 to aa:bb:cc:dd:ee:02',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText('a proximity hint, not a measured distance'),
    ).toBeTruthy();

    // Embedding work.
    expect(screen.getByText('Embedded')).toBeTruthy();
    expect(screen.getByText(/vector matches the current document/)).toBeTruthy();
  });

  it('reports an unavailable neighbourhood instead of an empty one', async () => {
    vi.spyOn(api, 'explainScoped').mockResolvedValue({
      source_key: 'proxy-1',
      dense_score: 0,
      sparse_score: 0,
      fused_score: 0,
      threat_boost: 0,
      boost_reasons: [],
      sequence_log_prob: 0,
      scores_available: false,
      found: true,
      source_kind: 'proxy_event',
    });
    vi.spyOn(api, 'recordContext').mockResolvedValue(
      contextFixture({
        source_key: 'proxy-1',
        related: null,
        related_unavailable_reason: 'This record carries no device MAC.',
        embedding: [],
        activity: [],
      }),
    );

    renderPage();
    await waitFor(() =>
      screen.getByText('This record carries no device MAC.'),
    );
    // The section heading stays; the peer list and its own heading do not, so an
    // unavailable neighbourhood is never shown as an empty result.
    expect(screen.queryByText('4 overlapping windows')).toBeNull();
    expect(
      screen.getByText(/No embedding job has been queued for this document/),
    ).toBeTruthy();
  });

  it('hides ranking factors when scores are unavailable', async () => {
    vi.spyOn(api, 'explainScoped').mockResolvedValue({
      source_key: 'frame-1',
      dense_score: 0,
      sparse_score: 0,
      fused_score: 0,
      threat_boost: 0,
      boost_reasons: [],
      sequence_log_prob: 0,
      scores_available: false,
      found: true,
      source_kind: 'event',
    });
    vi.spyOn(api, 'recordContext').mockResolvedValue(contextFixture());

    renderPage();
    await waitFor(() => screen.getByText('london-lab'));
    expect(screen.queryByText('Ranking factors')).toBeNull();
    expect(screen.getByText('Boost reasons')).toBeTruthy();
  });

  it('never renders a blank reason while context is still loading', async () => {
    vi.spyOn(api, 'explainScoped').mockResolvedValue({
      source_key: 'frame-1',
      dense_score: 0,
      sparse_score: 0,
      fused_score: 0,
      threat_boost: 0,
      boost_reasons: [],
      sequence_log_prob: 0,
      scores_available: true,
      found: true,
      source_kind: 'event',
      record: contextFixture().record!,
    });
    // A context that never settles is the case that used to pass an empty
    // string through as the reason and render a blank message.
    vi.spyOn(api, 'recordContext').mockReturnValue(new Promise(() => {}));

    renderPage();
    await waitFor(() => screen.getByText('london-lab'));
    expect(
      screen.getByText('Related devices are loading.'),
    ).toBeTruthy();
    const section = screen.getByText('Related devices are loading.');
    expect(section.textContent?.trim()).not.toBe('');
  });

  it('still renders the record when the context call fails', async () => {
    vi.spyOn(api, 'explainScoped').mockResolvedValue({
      source_key: 'frame-1',
      dense_score: 0,
      sparse_score: 0,
      fused_score: 0,
      threat_boost: 0,
      boost_reasons: [],
      sequence_log_prob: 0,
      scores_available: true,
      found: true,
      source_kind: 'event',
      record: contextFixture().record!,
      detail_json: '{"event_type":"data"}',
    });
    vi.spyOn(api, 'recordContext').mockRejectedValue(
      new Error('context unavailable'),
    );

    renderPage();
    await waitFor(() => screen.getByText('london-lab'));
    // The record still comes from the explain response, and every section the
    // failed call would have filled says so rather than reading as empty.
    expect(screen.getByText('sensor-north')).toBeTruthy();
    expect(screen.getAllByText(/context unavailable/).length).toBe(3);
    expect(screen.queryByText('Activity is loading.')).toBeNull();
    expect(screen.queryByText('Embedding state is loading.')).toBeNull();
  });
});
