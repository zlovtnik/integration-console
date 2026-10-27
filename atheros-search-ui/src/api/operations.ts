import type { SemanticHealth } from './types';

export type MeasurementStatus = 'current' | 'stale' | 'unavailable';

export interface PipelineStage {
  id: string;
  label: string;
  owner: 'octopus' | 'atheros-search';
  status: string;
  pending: number | null;
  running: number | null;
  completed: number | null;
  failed: number | null;
}

interface Throughput {
  bucket: string;
  series: { bucket_start: string; records: number }[];
}

export interface OperationsPipeline {
  scope: 'global';
  measured_at: string | null;
  status: MeasurementStatus;
  stages: PipelineStage[];
  workers: { type: string; last_seen_at: string }[];
  embedding: {
    dependency: string;
    pending: number | null;
    leased: number | null;
    completed: number | null;
    failed: number | null;
    retry_count: number | null;
    oldest_job_at: string | null;
    query_backend: SemanticHealth;
    worker_backend: SemanticHealth;
  };
  history: {
    status: string;
    as_of: string | null;
    peaks_status: string;
    peaks_computed_at: string | null;
    peak_records_day: number | null;
    peak_records_week: number | null;
    live_strip: {
      ingest_processed_rate_per_sec: number | null;
      pending_ledger_count: number | null;
      broker_lag_count: number | null;
      last_ingest_success_at: string | null;
      backpressure_active: boolean | null;
    } | null;
    throughput_24h: Throughput | null;
    throughput_7d: Throughput | null;
  };
}

export interface OperationSource {
  id: 'proxy' | 'wireless';
  label: string;
  ingestion: string;
  projection: string;
  lexical: string;
  semantic: string;
  documents: number | null;
  documents_24h: number | null;
  last_observed_at: string | null;
  vectors: number | null;
}

export interface OperationsSources {
  scope: 'global';
  measured_at: string | null;
  status: MeasurementStatus;
  sources: OperationSource[];
}

export interface ProxyLive {
  scope: 'global';
  status: MeasurementStatus | 'disabled';
  measured_at: string | null;
  active_tunnels: number | null;
  counters: {
    tunnels_opened: number;
    bytes_up: number;
    bytes_down: number;
    blocked: number;
    allowed: number;
    obfuscated: number;
    host_stats_dropped: number;
  } | null;
  classifications: Record<
    'ads_tracker' | 'analytics' | 'cdn' | 'essential_api' | 'auth' | 'unknown',
    number
  > | null;
  publisher: {
    configured: boolean;
    status: string;
    queue_depth: number;
    queue_capacity: number;
    spooled_total: number;
    enqueue_timeouts_total: number;
    last_attempt_at: string | null;
    last_publish_at: string | null;
  } | null;
  rates: {
    tunnels_per_second: number;
    bytes_up_per_second: number;
    bytes_down_per_second: number;
  } | null;
}
