import type {
  OperationsPipeline,
  OperationsSources,
  ProxyLive,
} from '~/api/operations';

export const pipelineFixture: OperationsPipeline = {
  scope: 'global',
  status: 'current',
  measured_at: '2026-10-26T12:00:00Z',
  stages: [
    {
      id: 'sync-scan-ingestion',
      label: 'Ingestion',
      owner: 'octopus',
      status: 'active',
      pending: 3,
      running: 1,
      completed: null,
      failed: 0,
    },
  ],
  workers: [{ type: 'embedding', last_seen_at: '2026-10-26T11:59:59Z' }],
  embedding: {
    dependency: 'healthy',
    pending: 2,
    leased: 1,
    completed: 5,
    failed: 0,
    retry_count: 0,
    oldest_job_at: null,
    query_backend: {
      preflight: 'compatible',
      circuit_state: 'closed',
      backend_available: true,
    },
    worker_backend: {
      preflight: 'compatible',
      circuit_state: 'closed',
      backend_available: true,
    },
  },
  history: {
    status: 'current',
    as_of: '2026-10-26T12:00:00Z',
    peaks_status: 'current',
    peaks_computed_at: '2026-10-26T11:59:00Z',
    peak_records_day: 100,
    peak_records_week: 500,
    live_strip: null,
    throughput_24h: {
      bucket: 'hour',
      series: [{ bucket_start: '2026-10-26T11:00:00Z', records: 10 }],
    },
    throughput_7d: null,
  },
};

export const sourcesFixture: OperationsSources = {
  scope: 'global',
  status: 'current',
  measured_at: '2026-10-26T12:00:00Z',
  sources: [
    {
      id: 'proxy',
      label: 'Proxy observations',
      ingestion: 'unknown',
      projection: 'stale',
      lexical: 'available',
      semantic: 'missing',
      documents: 20,
      documents_24h: 4,
      vectors: 0,
      last_observed_at: '2026-10-25T12:00:00Z',
    },
    {
      id: 'wireless',
      label: 'Wireless observations',
      ingestion: 'unknown',
      projection: 'unknown',
      lexical: 'unknown',
      semantic: 'unknown',
      documents: null,
      documents_24h: null,
      vectors: null,
      last_observed_at: null,
    },
  ],
};

export const proxyFixture: ProxyLive = {
  scope: 'global',
  status: 'current',
  measured_at: '2026-10-26T12:00:00Z',
  active_tunnels: 2,
  counters: {
    tunnels_opened: 20,
    bytes_up: 1000,
    bytes_down: 2000,
    blocked: 5,
    allowed: 15,
    obfuscated: 0,
    host_stats_dropped: 0,
  },
  classifications: {
    ads_tracker: 1,
    analytics: 1,
    cdn: 2,
    essential_api: 2,
    auth: 0,
    unknown: 14,
  },
  publisher: {
    configured: true,
    status: 'ok',
    queue_depth: 0,
    queue_capacity: 100,
    spooled_total: 0,
    enqueue_timeouts_total: 0,
    last_attempt_at: '2026-10-26T12:00:00Z',
    last_publish_at: '2026-10-26T12:00:00Z',
  },
  rates: null,
};
