import { A, useParams, useSearchParams } from '@solidjs/router';
import {
  createEffect,
  createMemo,
  createResource,
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
  const [explain] = createResource(explainRequest, async (request) => {
    const controller = new AbortController();
    controllers.add(controller);

    try {
      return await api.explain(
        request.sourceKey,
        request.query,
        request.kind,
        controller.signal,
      );
    } finally {
      controllers.delete(controller);
    }
  });

  const backHref = createMemo(() => {
    const query = queryParam();
    const kind = typeof searchParams.kind === 'string' ? searchParams.kind : '';
    return `/?q=${encodeURIComponent(query)}${kind ? `&kind=${encodeURIComponent(kind)}` : ''}`;
  });

  const errorMessage = () => {
    if (!sourceKey()) return 'Missing source key.';
    if (!explain.error) return '';
    return (explain.error as Error).message || 'Could not load explanation.';
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

      <Show when={!explain.loading} fallback={<SkeletonExplain />}>
        <Show
          when={!errorMessage()}
          fallback={
            <div class="state-banner state-banner--error" role="alert">
              {errorMessage()}
            </div>
          }
        >
          <Show when={explain()}>
            {(details) => (
              <div class="explain-grid">
                <section
                  aria-labelledby="score-breakdown-title"
                  class="explain-section"
                >
                  <h2 id="score-breakdown-title" class="heading-1">
                    Score breakdown
                  </h2>
                  <ScoreChart explain={details()} />
                </section>

                <section aria-labelledby="boost-title" class="explain-section">
                  <h2 id="boost-title" class="heading-1">
                    Boost reasons
                  </h2>
                  <Show
                    when={(details().boost_reasons ?? []).length > 0}
                    fallback={<p class="caption">No boost reasons.</p>}
                  >
                    <div class="badge-row">
                      <For each={details().boost_reasons}>
                        {(reason) => <BoostBadge reason={reason} />}
                      </For>
                    </div>
                  </Show>
                </section>

                <Show when={(details().sequence_tokens ?? []).length > 0}>
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
                      <For each={details().sequence_tokens}>
                        {(token) => <span class="sequence-token">{token}</span>}
                      </For>
                      <span class="mono">
                        {(details().sequence_log_prob ?? 0).toFixed(3)}
                      </span>
                    </div>
                  </section>
                </Show>

                <section
                  aria-labelledby="payload-title"
                  class="explain-section explain-section--wide"
                >
                  <h2 id="payload-title" class="heading-1">
                    Detail payload
                  </h2>
                  <JsonViewer
                    json={
                      details().detail_json ??
                      JSON.stringify(details(), null, 2)
                    }
                  />
                </section>
              </div>
            )}
          </Show>
        </Show>
      </Show>
    </main>
  );
}
