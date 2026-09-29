import { Show, createResource, onCleanup } from 'solid-js';
import type { ReportMetadata, SemanticHealth } from '~/api/types';
import { formatDateTime } from '~/utils/formatDateTime';
import { useSearchParams } from '@solidjs/router';
import { api } from '~/api/client';

function laneSummary(lane: SemanticHealth): string {
  if (lane.preflight === 'disabled') return 'not configured';
  const circuit = lane.circuit_state.replace(/_/g, ' ');
  return `${lane.preflight}, ${circuit}, ${
    lane.backend_available ? 'available' : 'unavailable'
  }`;
}

export function ReportStatus(props: {
  report?: ReportMetadata | undefined;
  generatedAt?: string | undefined;
}) {
  const [params] = useSearchParams();
  let controller: AbortController | undefined;
  const [health] = createResource(
    () => props.generatedAt ?? 'initial',
    async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        return await api.etlHealth(controller.signal);
      } catch {
        return null;
      }
    },
  );
  onCleanup(() => controller?.abort());
  return (
    <div class="report-status" role="status">
      <Show when={typeof params.scope_change === 'string'}>
        <p>{params.scope_change}</p>
      </Show>
      <p>
        Live results. Response generated:{' '}
        {props.generatedAt ? formatDateTime(props.generatedAt) : 'Unavailable'}.
      </p>
      <Show when={health.loading}>
        <p>Loading pipeline health...</p>
      </Show>
      <Show
        when={!health.loading && health()}
        fallback={
          <Show when={!health.loading}>
            <p>
              Pipeline health unavailable; no conclusion about sensor activity.
            </p>
          </Show>
        }
      >
        {(status) => {
          const observedAt = status().wireless_last_observed_at;
          const projection = status().wireless_projection;
          const queryLane = status().query_semantic;
          const workerLane = status().worker_semantic;
          return (
            <>
              <p>
                Pipeline health (global, measured{' '}
                {formatDateTime(status().measured_at)}):{' '}
                {status().ingest_pending} ingestion pending,{' '}
                {status().ingest_failed} failed; {status().embedding_pending}{' '}
                embeddings pending, {status().embedding_failed} failed (
                {status().embedding_dependency}). {status().wireless_events_24h}{' '}
                wireless events indexed in the last 24h
                {observedAt
                  ? `, newest ${formatDateTime(observedAt)}`
                  : ', newest observation unknown'}
                {projection ? ` (projection ${projection})` : ''}. These are
                operational counts, outside this report's scope.
              </p>
              <Show when={queryLane}>
                {(lane) => (
                  <p>
                    Semantic search: query lane {laneSummary(lane())}
                    {workerLane
                      ? ` · worker lane ${laneSummary(workerLane)}`
                      : ''}
                    .
                  </p>
                )}
              </Show>
            </>
          );
        }}
      </Show>
      <Show
        when={props.report}
        fallback={<p>Data freshness and coverage unavailable.</p>}
      >
        {(report) => (
          <>
            <p>
              Grain: {report().entity_grain}. Count: {report().count_meaning}.
            </p>
            <p>
              Observation range: {report().observation_start ?? 'Unknown'} to{' '}
              {report().observation_end ?? 'Unknown'}.{' '}
              {report().observation_basis}.
            </p>
            <p>
              {report().loaded_rows} loaded / {report().total_rows ?? 'unknown'}{' '}
              total. Data freshness: {report().freshness}.
              {report().incomplete_coverage
                ? ' Coverage is incomplete or unverified; absence is not proof of no activity.'
                : ''}
            </p>
            <Show when={report().freshness === 'stale'}>
              <p>Stale data: refresh before relying on recent observations.</p>
            </Show>
          </>
        )}
      </Show>
    </div>
  );
}
