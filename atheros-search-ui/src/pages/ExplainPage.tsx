import { A, useParams, useSearchParams } from '@solidjs/router';
import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { ArrowLeft } from 'lucide-solid';
import { api } from '~/api/client';
import type { ExplainResponse } from '~/api/types';
import { BoostBadge } from '~/components/BoostBadge';
import { JsonViewer } from '~/components/JsonViewer';
import { ScoreChart } from '~/components/ScoreChart';
import { SkeletonExplain } from '~/components/SkeletonExplain';

export default function ExplainPage() {
  const params = useParams();
  const sourceKey = () => {
    try {
      return decodeURIComponent(params.sourceKey ?? '');
    } catch {
      return '';
    }
  };
  const [searchParams] = useSearchParams();
  const [explain, setExplain] = createSignal<ExplainResponse | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const controller = new AbortController();

  onMount(async () => {
    document.title = `Explain: ${sourceKey()} - atheros search`;
    if (!sourceKey()) {
      setError('Missing source key.');
      setLoading(false);
      return;
    }

    try {
      const response = await api.explain(
        sourceKey(),
        typeof searchParams.query === 'string' ? searchParams.query : '',
        typeof searchParams.kind === 'string'
          ? searchParams.kind
          : 'SEARCH_KIND_EVENT',
        controller.signal,
      );
      setExplain(response);
    } catch (explainError) {
      setError(
        (explainError as Error).message || 'Could not load explanation.',
      );
    } finally {
      setLoading(false);
    }
  });

  onCleanup(() => controller.abort());

  return (
    <main id="main-content" class="main-content explain-page" tabIndex={-1}>
      <nav aria-label="Breadcrumb" class="breadcrumb">
        <A
          href={`/?q=${encodeURIComponent(
            typeof searchParams.query === 'string' ? searchParams.query : '',
          )}`}
          class="btn btn-ghost back-link"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          <span>
            Back to results
            {typeof searchParams.query === 'string' && searchParams.query
              ? ` for "${searchParams.query}"`
              : ''}
          </span>
        </A>
      </nav>

      <h1 class="display">Explain: {sourceKey()}</h1>

      <Show when={!loading()} fallback={<SkeletonExplain />}>
        <Show
          when={!error()}
          fallback={
            <div class="state-banner state-banner--error" role="alert">
              {error()}
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
