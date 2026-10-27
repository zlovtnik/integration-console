import { For, Show } from 'solid-js';
import { pipeline, pipelineError } from '~/stores/operationsStore';
import {
  measurement,
  measuredTime,
  OperationStatus,
} from '~/components/OperationsStatus';

export default function IngestionPage() {
  return (
    <main id="main-content" class="main-content operations-page" tabIndex={-1}>
      <div class="page-heading-row">
        <div>
          <h1>Ingestion</h1>
          <p class="caption">
            Global pipeline measurements. Retrieval filters do not scope these
            counts.
          </p>
        </div>
        <OperationStatus
          value={pipelineError() ? 'unavailable' : pipeline()?.status}
        />
      </div>
      <p class="caption">
        Measured at <time>{measuredTime(pipeline()?.measured_at)}</time>.
        Refreshes every 30 seconds; measurements older than 60 seconds are
        stale.
      </p>
      <Show
        when={pipeline()}
        fallback={
          <p role="status" class="state-banner">
            {pipelineError()
              ? 'Pipeline measurements unavailable. Retrieval remains available.'
              : 'Loading pipeline measurements...'}
          </p>
        }
      >
        {(value) => (
          <>
            <section class="operations-panel">
              <h2>Source to retrieval</h2>
              <p class="caption">
                Ingestion, maintained projections, lexical indexing and semantic
                coverage are separate measurements. Unknown values do not
                indicate readiness.
              </p>
              <div
                class="operations-table-wrap"
                // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- The overflowing table region must support keyboard scrolling.
                tabIndex={0}
                role="region"
                aria-label="Pipeline stages"
              >
                <table class="operations-table">
                  <thead>
                    <tr>
                      <th scope="col">Stage</th>
                      <th scope="col">Owner</th>
                      <th scope="col">Status</th>
                      <th scope="col">Pending</th>
                      <th scope="col">Running</th>
                      <th scope="col">Completed</th>
                      <th scope="col">Failed</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={value().stages}>
                      {(stage) => (
                        <tr>
                          <th scope="row">{stage.label}</th>
                          <td>{stage.owner}</td>
                          <td>
                            <OperationStatus value={stage.status} />
                          </td>
                          <td>{measurement(stage.pending)}</td>
                          <td>{measurement(stage.running)}</td>
                          <td>{measurement(stage.completed)}</td>
                          <td>{measurement(stage.failed)}</td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </section>
            <div class="operations-grid">
              <section class="operations-panel">
                <h2>Embedding execution</h2>
                <dl class="operations-facts">
                  <dt>Dependency</dt>
                  <dd>
                    <OperationStatus value={value().embedding.dependency} />
                  </dd>
                  <dt>Pending / leased</dt>
                  <dd>
                    {measurement(value().embedding.pending)} /{' '}
                    {measurement(value().embedding.leased)}
                  </dd>
                  <dt>Failed / retries</dt>
                  <dd>
                    {measurement(value().embedding.failed)} /{' '}
                    {measurement(value().embedding.retry_count)}
                  </dd>
                  <dt>Oldest job</dt>
                  <dd>{measuredTime(value().embedding.oldest_job_at)}</dd>
                  <dt>Query backend</dt>
                  <dd>
                    {value().embedding.query_backend?.preflight || 'unknown'} /{' '}
                    {value().embedding.query_backend?.circuit_state ||
                      'unknown'}
                  </dd>
                  <dt>Worker backend</dt>
                  <dd>
                    {value().embedding.worker_backend?.preflight || 'unknown'} /{' '}
                    {value().embedding.worker_backend?.circuit_state ||
                      'unknown'}
                  </dd>
                </dl>
                <p class="caption">
                  Octopus creates durable jobs. Search workers execute fenced
                  embedding leases; their recovery responsibilities remain
                  separate.
                </p>
              </section>
              <section class="operations-panel">
                <h2>Worker freshness</h2>
                <p class="caption">
                  Last observed worker heartbeat; absence does not mean zero
                  workers.
                </p>
                <ul class="operations-list">
                  <For
                    each={value().workers}
                    fallback={<li>Worker measurements unknown</li>}
                  >
                    {(worker) => (
                      <li>
                        <strong>{worker.type}</strong>
                        <time>{measuredTime(worker.last_seen_at)}</time>
                      </li>
                    )}
                  </For>
                </ul>
              </section>
            </div>
            <section class="operations-panel">
              <h2>Materialized live measurements</h2>
              <OperationStatus value={value().history.status} />
              <p class="caption">
                Snapshot as of {measuredTime(value().history.as_of)}. Live
                measurements expire after 180 seconds.
              </p>
              <dl class="operations-facts">
                <dt>Records / second</dt>
                <dd>
                  {measurement(
                    value().history.live_strip?.ingest_processed_rate_per_sec,
                  )}
                </dd>
                <dt>Pending ledger / broker lag</dt>
                <dd>
                  {measurement(
                    value().history.live_strip?.pending_ledger_count,
                  )}{' '}
                  / {measurement(value().history.live_strip?.broker_lag_count)}
                </dd>
                <dt>Last ingestion success</dt>
                <dd>
                  {measuredTime(
                    value().history.live_strip?.last_ingest_success_at,
                  )}
                </dd>
                <dt>Backpressure</dt>
                <dd>
                  {value().history.live_strip?.backpressure_active == null
                    ? 'Unknown'
                    : value().history.live_strip?.backpressure_active
                      ? 'Active'
                      : 'Inactive'}
                </dd>
              </dl>
            </section>
            <section class="operations-panel">
              <h2>Materialized throughput history</h2>
              <OperationStatus value={value().history.peaks_status} />
              <p class="caption">
                Snapshot as of {measuredTime(value().history.as_of)}; peaks
                computed at {measuredTime(value().history.peaks_computed_at)}.
                Peak measurements expire after 360 seconds. History is not a
                live reading.
              </p>
              <dl class="operations-facts">
                <dt>Peak records / day</dt>
                <dd>{measurement(value().history.peak_records_day)}</dd>
                <dt>Peak records / week</dt>
                <dd>{measurement(value().history.peak_records_week)}</dd>
              </dl>
              <details>
                <summary>Inspect throughput buckets</summary>
                <For
                  each={[
                    {
                      label: 'Last 24 hours',
                      data: value().history.throughput_24h,
                    },
                    {
                      label: 'Last 7 days',
                      data: value().history.throughput_7d,
                    },
                  ]}
                >
                  {(history) => (
                    <section>
                      <h3>{history.label}</h3>
                      <p class="caption">
                        Bucket: {history.data?.bucket || 'unknown'}
                      </p>
                      <div
                        class="operations-table-wrap"
                        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- The overflowing table region must support keyboard scrolling.
                        tabIndex={0}
                        role="region"
                        aria-label={history.label}
                      >
                        <table class="operations-table">
                          <thead>
                            <tr>
                              <th scope="col">Bucket start</th>
                              <th scope="col">Records</th>
                            </tr>
                          </thead>
                          <tbody>
                            <For
                              each={history.data?.series}
                              fallback={
                                <tr>
                                  <td colSpan={2}>History unavailable</td>
                                </tr>
                              }
                            >
                              {(bucket) => (
                                <tr>
                                  <td>{bucket.bucket_start}</td>
                                  <td>{measurement(bucket.records)}</td>
                                </tr>
                              )}
                            </For>
                          </tbody>
                        </table>
                      </div>
                    </section>
                  )}
                </For>
              </details>
            </section>
          </>
        )}
      </Show>
    </main>
  );
}
