import { A, useLocation } from '@solidjs/router';
import {
  createEffect,
  createResource,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { api, ApiError } from '~/api/client';
import { auditGeneration } from '~/auth/auditState';
import { canRequestProxyLive } from '~/auth/session';
import {
  measurement,
  measuredTime,
  OperationStatus,
} from '~/components/OperationsStatus';

export default function SourcesPage() {
  const location = useLocation();
  const proxyDetail = () => location.pathname === '/sources/proxy';
  let sourcesController: AbortController | undefined;
  let liveController: AbortController | undefined;
  const [liveRequested, setLiveRequested] = createSignal(false);
  const [sources, { mutate: clearSources, refetch }] = createResource(
    auditGeneration,
    async () => {
      sourcesController?.abort();
      sourcesController = new AbortController();
      try {
        return { data: await api.operationsSources(sourcesController.signal) };
      } catch {
        return { error: true };
      }
    },
  );
  const [live, { mutate: clearLive, refetch: refreshLive }] = createResource(
    () =>
      liveRequested() && proxyDetail() && canRequestProxyLive()
        ? auditGeneration() + 1
        : false,
    async () => {
      liveController?.abort();
      liveController = new AbortController();
      try {
        return { data: await api.proxyLive(liveController.signal) };
      } catch (error) {
        return {
          denied: error instanceof ApiError && error.status === 403,
          error: true,
        };
      }
    },
  );
  createEffect(
    on(
      auditGeneration,
      () => {
        liveController?.abort();
        clearSources(undefined);
        clearLive(undefined);
        setLiveRequested(false);
      },
      { defer: true },
    ),
  );
  createEffect(() => {
    if (!proxyDetail() || !canRequestProxyLive()) {
      liveController?.abort();
      clearLive(undefined);
      setLiveRequested(false);
    }
  });
  onMount(() => {
    // eslint-disable-next-line solid/reactivity -- Interval callback reads the current resource loading state.
    const timer = window.setInterval(() => {
      if (!sources.loading) void refetch();
    }, 30_000);
    // eslint-disable-next-line solid/reactivity -- Interval callback reads current authorization-dependent polling state.
    const liveTimer = window.setInterval(() => {
      if (liveRequested() && !live.loading && !live()?.denied)
        void refreshLive();
    }, 5000);
    onCleanup(() => {
      window.clearInterval(timer);
      window.clearInterval(liveTimer);
      sourcesController?.abort();
      liveController?.abort();
    });
  });
  const proxy = () =>
    sources()?.data?.sources.find((source) => source.id === 'proxy');
  return (
    <main id="main-content" class="main-content operations-page" tabIndex={-1}>
      <div class="page-heading-row">
        <div>
          <h1>{proxyDetail() ? 'Proxy source' : 'Sources'}</h1>
          <p class="caption">
            Global retained evidence and source readiness. Observation counts do
            not establish sensor coverage or identity.
          </p>
        </div>
        <OperationStatus value={sources()?.data?.status} />
      </div>
      <p class="caption">
        Measured at {measuredTime(sources()?.data?.measured_at)}. Missing values
        remain unknown.
      </p>
      <Show
        when={sources()?.data}
        fallback={
          <p role="status" class="state-banner">
            {sources.loading
              ? 'Loading source measurements...'
              : 'Source measurements unavailable. Retrieval remains available.'}
          </p>
        }
      >
        <section class="operations-panel">
          <h2>Indexed evidence</h2>
          <div
            class="operations-table-wrap"
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- The overflowing table region must support keyboard scrolling.
            tabIndex={0}
            role="region"
            aria-label="Source readiness"
          >
            <table class="operations-table">
              <thead>
                <tr>
                  <th scope="col">Source</th>
                  <th scope="col">Ingestion</th>
                  <th scope="col">Projection</th>
                  <th scope="col">Lexical</th>
                  <th scope="col">Semantic</th>
                  <th scope="col">Documents</th>
                  <th scope="col">Last 24h</th>
                  <th scope="col">Vectors</th>
                  <th scope="col">Last observed</th>
                </tr>
              </thead>
              <tbody>
                <For
                  each={sources()?.data?.sources.filter(
                    (source) => !proxyDetail() || source.id === 'proxy',
                  )}
                >
                  {(source) => (
                    <tr>
                      <th scope="row">
                        <Show
                          when={source.id === 'proxy'}
                          fallback={source.label}
                        >
                          <A href="/sources/proxy">{source.label}</A>
                        </Show>
                      </th>
                      <td>
                        <OperationStatus value={source.ingestion} />
                      </td>
                      <td>
                        <OperationStatus value={source.projection} />
                      </td>
                      <td>
                        <OperationStatus value={source.lexical} />
                      </td>
                      <td>
                        <OperationStatus value={source.semantic} />
                      </td>
                      <td>{measurement(source.documents)}</td>
                      <td>{measurement(source.documents_24h)}</td>
                      <td>{measurement(source.vectors)}</td>
                      <td>{measuredTime(source.last_observed_at)}</td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
          <p class="caption">
            Semantic coverage describes available indexed vectors; backend
            availability alone does not establish coverage.
          </p>
        </section>
      </Show>
      <Show
        when={proxyDetail()}
        fallback={
          <p>
            <A href="/sources/proxy" class="btn btn-secondary">
              Inspect proxy source
            </A>
          </p>
        }
      >
        <section class="operations-panel">
          <h2>Retrieve proxy evidence</h2>
          <p>
            {measurement(proxy()?.documents)} retained documents. Indexed
            evidence reflects ingestion and projections; live traffic below is a
            separate measurement.
          </p>
          <A
            class="btn btn-secondary"
            href="/?q=*&kind=SEARCH_KIND_PROXY_EVENT&mode=SEARCH_MODE_SPARSE"
          >
            Search proxy events
          </A>
        </section>
        <section class="operations-panel">
          <h2>Live aggregate telemetry</h2>
          <p class="caption">
            Operator/admin only. Shared five-second sample; stale after 15
            seconds, unavailable after 60 seconds. Telemetry failures do not
            affect retrieval readiness.
          </p>
          <Show
            when={canRequestProxyLive()}
            fallback={<p>Live telemetry requires an operator or admin role.</p>}
          >
            <Show
              when={liveRequested()}
              fallback={
                <button
                  type="button"
                  class="btn btn-secondary"
                  onClick={() => setLiveRequested(true)}
                >
                  Load live telemetry
                </button>
              }
            >
              <Show
                when={live()?.data}
                fallback={
                  <p role="status">
                    {live()?.denied
                      ? 'Live telemetry requires an operator or admin role. Indexed evidence remains available.'
                      : live.loading
                        ? 'Loading live telemetry...'
                        : 'Live telemetry unavailable.'}
                  </p>
                }
              >
                {(snapshot) => (
                  <>
                    <OperationStatus value={snapshot().status} />
                    <p class="caption">
                      Measured at {measuredTime(snapshot().measured_at)}
                    </p>
                    <dl class="operations-facts">
                      <dt>Active tunnels</dt>
                      <dd>{measurement(snapshot().active_tunnels)}</dd>
                      <dt>Tunnels opened (cumulative)</dt>
                      <dd>
                        {measurement(snapshot().counters?.tunnels_opened)}
                      </dd>
                      <dt>Allowed / blocked (cumulative)</dt>
                      <dd>
                        {measurement(snapshot().counters?.allowed)} /{' '}
                        {measurement(snapshot().counters?.blocked)}
                      </dd>
                      <dt>Bytes up / down (cumulative)</dt>
                      <dd>
                        {measurement(snapshot().counters?.bytes_up)} /{' '}
                        {measurement(snapshot().counters?.bytes_down)}
                      </dd>
                      <dt>Tunnels / second</dt>
                      <dd>
                        {measurement(snapshot().rates?.tunnels_per_second)}
                      </dd>
                      <dt>Bytes up / down per second</dt>
                      <dd>
                        {measurement(snapshot().rates?.bytes_up_per_second)} /{' '}
                        {measurement(snapshot().rates?.bytes_down_per_second)}
                      </dd>
                      <dt>Publisher</dt>
                      <dd>
                        <OperationStatus value={snapshot().publisher?.status} />
                      </dd>
                      <dt>Publisher queue</dt>
                      <dd>
                        {measurement(snapshot().publisher?.queue_depth)} /{' '}
                        {measurement(snapshot().publisher?.queue_capacity)}
                      </dd>
                      <dt>Last publication</dt>
                      <dd>
                        {measuredTime(snapshot().publisher?.last_publish_at)}
                      </dd>
                    </dl>
                    <Show when={!snapshot().rates}>
                      <p class="caption">
                        Rates unavailable on first sample, counter reset or
                        process change.
                      </p>
                    </Show>
                    <details>
                      <summary>Classification counters</summary>
                      <dl class="operations-facts">
                        <For
                          each={Object.entries(
                            snapshot().classifications ?? {},
                          )}
                        >
                          {([classification, count]) => (
                            <>
                              <dt>{classification}</dt>
                              <dd>{measurement(count)}</dd>
                            </>
                          )}
                        </For>
                      </dl>
                      <Show when={!snapshot().classifications}>
                        <p>Classification measurements unknown.</p>
                      </Show>
                    </details>
                  </>
                )}
              </Show>
            </Show>
          </Show>
        </section>
        <A href="/sources">All sources</A>
      </Show>
    </main>
  );
}
