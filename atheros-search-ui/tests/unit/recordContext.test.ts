import { describe, expect, it } from 'vitest';
import { normalizeRecordContext } from '~/api/client';

describe('record context normalization', () => {
  it('reads the record, activity, related and embedding sections', () => {
    const result = normalizeRecordContext({
      source_key: 'frame-1',
      found: true,
      window_start: '2026-03-03T09:15:00Z',
      window_end: '2026-03-04T09:16:00Z',
      bucket_minutes: 15,
      generated_at: '2026-03-04T09:16:00Z',
      record: {
        document_id: 'doc-1',
        source_key: 'frame-1',
        source_kind: 'event',
        status: 'active',
        source_mac: 'aa:bb:cc:dd:ee:01',
        bssid: 'aa:bb:cc:dd:ee:ff',
        ssid: 'lab',
        location_id: 'london',
        sensor_id: 'north',
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
        sequence_tokens: ['a', 'b'],
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
        peak_window: '2026-03-04T09:00:00Z',
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
            confidence: 'proximity hint',
            fresh: true,
            evidence_references: ['signal-summary:x'],
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
          last_error: '',
          has_vector: true,
          content_current: true,
        },
      ],
      freshness: {
        coverage_status: 'partial',
        coverage_reason: 'projection lagged',
      },
    });

    expect(result.found).toBe(true);
    expect(result.record?.source_mac).toBe('aa:bb:cc:dd:ee:01');
    expect(result.record?.tags).toEqual(['threat:probe']);
    expect(result.record?.sequence_tokens).toEqual(['a', 'b']);
    expect(result.record?.blocked).toBeNull();
    expect(result.activity).toHaveLength(1);
    expect(result.activity[0]?.frames_per_minute).toBe(4);
    expect(result.activity[0]?.rssi_avg_dbm).toBe(-55.5);
    expect(result.activity_totals.peak_frames_per_minute).toBe(4);
    expect(result.related?.neighbours[0]?.corroborated).toBe(true);
    expect(result.related?.links[0]?.weight_basis).toBe('time_overlap_windows');
    expect(result.embedding[0]?.content_current).toBe(true);
    expect(result.embedding[0]?.last_error).toBeUndefined();
    expect(result.freshness?.coverage_status).toBe('partial');
  });

  it('keeps a null neighbourhood distinct from an empty one', () => {
    const unavailable = normalizeRecordContext({
      source_key: 'proxy-1',
      found: true,
      related: null,
      related_unavailable_reason: 'no MAC or BSSID on this record',
      activity: [],
      embedding: [],
      generated_at: '2026-03-04T09:16:00Z',
      window_start: '2026-03-03T09:16:00Z',
      window_end: '2026-03-04T09:16:00Z',
      bucket_minutes: 15,
    });
    expect(unavailable.related).toBeNull();
    expect(unavailable.related_unavailable_reason).toContain('no MAC or BSSID');
    expect(unavailable.activity).toEqual([]);
    expect(unavailable.embedding).toEqual([]);

    const empty = normalizeRecordContext({
      source_key: 'frame-2',
      found: true,
      related: { anchor_kind: 'device', anchor_id: 'a', neighbours: [], links: [] },
      activity: [],
      embedding: [],
      generated_at: 'now',
      window_start: 'then',
      window_end: 'now',
      bucket_minutes: 15,
    });
    expect(empty.related).not.toBeNull();
    expect(empty.related?.neighbours).toEqual([]);
  });

  it('tolerates camelCase and missing sections', () => {
    const result = normalizeRecordContext({
      sourceKey: 'frame-3',
      found: true,
      bucketMinutes: 60,
      record: { sourceMac: 'aa:bb:cc:dd:ee:03', sourceKind: 'event' },
      activityTotals: { frameCount: 12, peakFramesPerMinute: 1.5 },
    });
    expect(result.source_key).toBe('frame-3');
    expect(result.bucket_minutes).toBe(60);
    expect(result.record?.source_mac).toBe('aa:bb:cc:dd:ee:03');
    expect(result.record?.source_kind).toBe('event');
    expect(result.activity_totals.frame_count).toBe(12);
    expect(result.activity_totals.peak_frames_per_minute).toBe(1.5);
    expect(result.related).toBeNull();
    expect(result.freshness).toBeUndefined();
  });

  it('does not invent a coverage status', () => {
    const result = normalizeRecordContext({
      found: true,
      freshness: { coverage_status: 'nonsense' },
    });
    expect(result.freshness?.coverage_status).toBe('unknown');
  });
});
