import { A, useParams, useSearchParams } from '@solidjs/router';
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  on,
  onCleanup,
  Show,
} from 'solid-js';
import { ArrowLeft } from 'lucide-solid';
import { api } from '~/api/client';
import { BoostBadge } from '~/components/BoostBadge';
import { JsonViewer } from '~/components/JsonViewer';
import { ScoreChart } from '~/components/ScoreChart';
import { SkeletonExplain } from '~/components/SkeletonExplain';
import { ActivityTimeline } from '~/components/explain/ActivityTimeline';
import { EmbeddingWorkList } from '~/components/explain/EmbeddingWork';
import { RecordSummary } from '~/components/explain/RecordSummary';
import { RelatedDevices } from '~/components/explain/RelatedDevices';
import { isSameOriginRelative } from '~/auth/returnPath';
import type { RecordContextResponse, SearchFilters } from '~/api/types';
import type { Rfc3339Timestamp } from '~/utils/timestamp';

export default function ExplainPage() {
  const params = useParams();
  const [searchParams] = useSearchParams();
  const controllers = new Set<AbortController>();
  const sourceKey = () => {
    try {
      return decodeURIComponent(params.sourceKey ?? '');
    } catch {
      return '';
    }
  };

  const queryParam = () =>
    typeof searchParams.query === 'string' ? searchParams.query : '';
  const kindParam = () =>
    typeof searchParams.kind === 'string'
      ? searchParams.kind
      : 'SEARCH_KIND_EVENT';
  const explainRequest = () => {
    const key = sourceKey();
    if (!key) return null;
    return {
      sourceKey: key,
      query: queryParam(),
      kind: kindParam(),
    };
  };
  const scopedFilters = (): SearchFilters => {
    const filters: SearchFilters = {};
    const list = (key: string) =>
      typeof searchParams[key] === 'string'
        ? searchParams[key].split(',').map((item) => item.trim()).filter(Boolean)
        : [];
    const locations = list('loc');
    const sensors = list('sensor');
    const macs = list('mac');
    if (locations.length) filters.location_ids = locations;
    if (sensors.length) filters.sensor_ids = sensors;
    if (macs.length) filters.source_macs = macs;
    if (typeof searchParams.bssid === 'string') filters.bssid = searchParams.bssid;
    if (typeof searchParams.ssid === 'string') filters.ssid = searchParams.ssid;
    if (typeof searchParams.after === 'string') filters.observed_after = searchParams.after as Rfc3339Timestamp;
    if (typeof searchParams.before === 'string') filters.observed_before = searchParams.before as Rfc3339Timestamp;
    return filters;
  };

  const track = <T,>(signal: AbortSignal, run: () => Promise<T>) => {
    const controller = new AbortController();
    controllers.add(controller);
    signal.addEventListener('abort', () => controller.abort(), { once: true });
    return run()
      .catch((cause) => {
        if (!controller.signal.aborted) throw cause;
        return undefined;
      })
      .finally(() => controllers.delete(controller));
  };

  // Ranking and context are independent, so a context failure degrades to the
  // ranking view instead of blanking the page.
  const [explain] = createResource(explainRequest, async (request) => {
    const controller = new AbortController();
    controllers.add(controller);
    try {
      return await api.explainScoped({
        source_key: request.sourceKey,
        query: request.query,
        kind: request.kind,
        filters: scopedFilters(),
      }, controller.signal);
    } finally {
      controllers.delete(controller);
    }
  });

  // Ranking and context are independent. The context failure is captured here
  // rather than left to the resource: a rejected fetcher leaves the resource in
  // its loading state and raises an unhandled rejection, which would both hide
  // the failure and surface a noisy rejection on every failed call.
  const [contextFailure, setContextFailure] = createSignal('');
  const [context] = createResource(explainRequest, async (request) => {
    const controller = new AbortController();
    controllers.add(controller);
    try {
      return await api.recordContext(
        request.sourceKey,
        { kind: request.kind },
        controller.signal,
      );
    } catch (cause) {
      if (!controller.signal.aborted) {
        setContextFailure(
          cause instanceof Error && cause.message
            ? cause.message
            : 'Record context is unavailable.',
        );
      }
      return undefined;
    } finally {
      controllers.delete(controller);
    }
  });

  const backHref = createMemo(() => {
    const back = searchParams.return;
    if (typeof back === 'string' && isSameOriginRelative(back)) return back;
    const query = queryParam();
    const kind = typeof searchParams.kind === 'string' ? searchParams.kind : '';
    return `/?q=${encodeURIComponent(query)}${kind ? `&kind=${encodeURIComponent(kind)}` : ''}`;
  });

  const errorMessage = () => {
    if (!sourceKey()) return 'Missing source key.';
    if (!explain.error) return '';
    return (explain.error as Error).message || 'Could not load explanation.';
  };

  const recordMissing = () => {
    const details = explain();
    if (details) return details.found === false;
    return context()?.found === false;
  };

  const scoresAvailable = () => {
    const details = explain();
    if (!details) return false;
    return details.scores_available !== false;
  };

  // The record comes from the context call when it succeeded, because it carries
  // the resolved fields for a link that was opened cold, with no search result
  // behind it.
  const record = () => context()?.record ?? explain()?.record;

  const detailPayload = () => {
    const fields = record();
    if (fields?.detail_json) return fields.detail_json;
    const details = explain();
    if (details?.detail_json) return details.detail_json;
    return JSON.stringify(details ?? {}, null, 2);
  };

  const sequenceTokens = () => {
    const fromRecord = record()?.sequence_tokens;
    if (fromRecord && fromRecord.length > 0) return fromRecord;
    return explain()?.sequence_tokens ?? [];
  };

  const graphHref = (mac: string) => {
    const scope = new URLSearchParams();
    scope.set('mac', mac);
    const kind = kindParam();
    if (kind) scope.set('kind', kind);
    return `/graph?${scope.toString()}`;
  };

  const contextError = () => contextFailure();

  const reportFreshness = (data: RecordContextResponse) => {
    const status = data.freshness?.coverage_status;
    if (status && status !== 'complete') {
      const reason = data.freshness?.coverage_reason;
      return `Projection coverage is ${status}${reason ? `: ${reason}` : ''}. Absent evidence below is not proof of absence.`;
    }
    return '';
  };

  createEffect(
    on(sourceKey, (key) => {
      document.title = key
        ? `Explain: ${key} - atheros search`
        : 'Explain - atheros search';
    }),
  );

  onCleanup(() => {
    for (const controller of controllers) controller.abort();
    controllers.clear();
  });

  return (
    <main id="main-content" class="main-content explain-page" tabIndex={-1}>
      <nav aria-label="Breadcrumb" class="breadcrumb">
        <A href={backHref()} class="btn btn-ghost back-link">
          <ArrowLeft size={16} aria-hidden="true" />
          <span>
            Back to results
            {queryParam() ? ` for "${queryParam()}"` : ''}
          </span>
        </A>
      </nav>

      <h1 class="display">Explain: {sourceKey()}</h1>
      <p>
        The stored record, when it was observed and how fast, which devices
        shared its sensor windows, and the embedding work behind it.
      </p>

      <Show when={!explain.loading} fallback={<SkeletonExplain />}>
        <Show
          when={!errorMessage()}
          fallback={
            <div class="state-banner state-banner--error" role="alert">
              {errorMessage()}
            </div>
          }
        >
          <Show
            when={!recordMissing()}
            fallback={
              <section class="explain-section explain-section--wide">
                <h2 class="heading-1">Record not found</h2>
                <p class="caption" role="status">
                  No record with this source key exists in the current data set.
                  It may have been removed or the link may be outdated.
                </p>
              </section>
            }
          >
            <div class="explain-grid">
              <section
                aria-labelledby="record-title"
                class="explain-section"
              >
                <h2 id="record-title" class="heading-1">
                  Record
                </h2>
                <Show
                  when={record()}
                  fallback={
                    <p class="caption" role="status">
                      {contextError() ||
                        'The record fields are unavailable. Open this link from a search result to see them.'}
                    </p>
                  }
                >
                  {(fields) => <RecordSummary record={fields()} />}
                </Show>
              </section>

              <section
                aria-labelledby="activity-title"
                class="explain-section"
              >
                <h2 id="activity-title" class="heading-1">
                  Activity
                </h2>
                <Show
                  when={context()}
                  fallback={
                    <p class="caption" role="status">
                      {contextError() || 'Activity is loading.'}
                    </p>
                  }
                >
                  {(data) => (
                    <>
                      <ActivityTimeline
                        activity={data().activity}
                        totals={data().activity_totals}
                        bucketMinutes={data().bucket_minutes}
                      />
                      <Show when={reportFreshness(data())}>
                        <p class="caption" role="status">
                          {reportFreshness(data())}
                        </p>
                      </Show>
                    </>
                  )}
                </Show>
              </section>

              <section
                aria-labelledby="related-title"
                class="explain-section"
              >
                <h2 id="related-title" class="heading-1">
                  Related devices
                </h2>
                <RelatedDevices
                  related={context()?.related ?? null}
                  unavailableReason={
                    // contextError() is an empty string when nothing has
                    // failed, and `??` would pass that through as a reason,
                    // rendering a blank message instead of the default.
                    context()?.related_unavailable_reason ||
                    contextError() ||
                    (context.loading
                      ? 'Related devices are loading.'
                      : undefined)
                  }
                  graphHref={graphHref}
                />
              </section>

              <section
                aria-labelledby="embedding-title"
                class="explain-section"
              >
                <h2 id="embedding-title" class="heading-1">
                  Embedding work
                </h2>
                <Show
                  when={context()}
                  fallback={
                    <p class="caption" role="status">
                      {contextError() || 'Embedding state is loading.'}
                    </p>
                  }
                >
                  {(data) => (
                    <EmbeddingWorkList
                      work={data().embedding}
                      note={data().embedding_note}
                    />
                  )}
                </Show>
              </section>

              <Show when={sequenceTokens().length > 0}>
                <section
                  aria-labelledby="sequence-title"
                  class="explain-section"
                >
                  <h2 id="sequence-title" class="heading-1">
                    Frame sequence
                  </h2>
                  <p class="caption">
                    Log-probability of this event sequence under the trained
                    model. Lower scores indicate more unusual ordering.
                  </p>
                  <div class="sequence-row">
                    <For each={sequenceTokens()}>
                      {(token) => <span class="sequence-token">{token}</span>}
                    </For>
                    <span class="mono">
                      {(explain()?.sequence_log_prob ?? 0).toFixed(3)}
                    </span>
                  </div>
                </section>
              </Show>

              <Show when={(explain()?.boost_reasons ?? []).length > 0}>
                <div class="badge-row">
                  <For each={explain()?.boost_reasons ?? []}>
                    {(reason) => <BoostBadge reason={reason} />}
                  </For>
                </div>
              </Show>

              <Show
                when={scoresAvailable()}
                fallback={
                  <section
                    aria-labelledby="boost-title"
                    class="explain-section"
                  >
                    <h2 id="boost-title" class="heading-1">
                      Boost reasons
                    </h2>
                    <Show
                      when={(explain()?.boost_reasons ?? []).length > 0}
                      fallback={
                        <p class="caption">No boost reasons.</p>
                      }
                    >
                      <div class="badge-row">
                        <For each={explain()?.boost_reasons ?? []}>
                          {(reason) => <BoostBadge reason={reason} />}
                        </For>
                      </div>
                    </Show>
                  </section>
                }
              >
                <details class="explain-section">
                  <summary class="heading-1">Ranking factors</summary>
                  <div class="explain-section-body">
                    <ScoreChart explain={explain()!} />
                  </div>
                </details>
              </Show>

              <section
                aria-labelledby="payload-title"
                class="explain-section explain-section--wide"
              >
                <h2 id="payload-title" class="heading-1">
                  Detail payload
                </h2>
                <JsonViewer json={detailPayload()} />
              </section>
            </div>
          </Show>
        </Show>
      </Show>
    </main>
  );
}
