import { useNavigate } from '@solidjs/router';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import {
  ChevronDown,
  Filter,
  Search as SearchIcon,
  Square,
} from 'lucide-solid';
import { ApiError, api } from '~/api/client';
import { FilterChips } from '~/components/FilterChips';
import { FilterPanel } from '~/components/FilterPanel';
import { KindSelector } from '~/components/KindSelector';
import { ModeSelector } from '~/components/ModeSelector';
import { ResultCard } from '~/components/ResultCard';
import { SearchBar } from '~/components/SearchBar';
import { SkeletonCard } from '~/components/SkeletonCard';
import { useKeyboardShortcuts } from '~/hooks/useKeyboardShortcuts';
import { useScrollRestoration } from '~/hooks/useScrollRestoration';
import { useSearchStream } from '~/hooks/useSearchStream';
import { useSuggest } from '~/hooks/useSuggest';
import { useUrlSync } from '~/hooks/useUrlSync';
import {
  buildSearchRequest,
  clearResults,
  error,
  kind,
  loading,
  meta,
  mode,
  pushHistory,
  query,
  replaceResults,
  results,
  setError,
  setLoading,
  setMeta,
  setQuery,
  streaming,
  topK,
} from '~/stores/searchStore';
import { shortcutsOpen, setShortcutsOpen } from '~/stores/uiStore';
import { friendlyError } from '~/utils/friendlyError';

function describeError(errorValue: unknown): string {
  if (errorValue instanceof ApiError) {
    const code = errorValue.code?.toLowerCase();
    if (
      code === 'invalid_argument' ||
      code === 'invalid_query' ||
      code === 'validation_error'
    ) {
      return `HTTP ${errorValue.status}: Invalid search request. ${errorValue.message}`;
    }
    if (code === 'unauthenticated' || code === 'permission_denied') {
      return `HTTP ${errorValue.status}: Authentication required.`;
    }
    if (code === 'rate_limited' || code === 'resource_exhausted') {
      return `HTTP ${errorValue.status}: Too many search requests. Try again shortly.`;
    }
    return `HTTP ${errorValue.status}: ${errorValue.message}`;
  }
  if (errorValue instanceof Error && errorValue.name === 'AbortError') {
    return 'Search timed out.';
  }
  return (
    (errorValue instanceof Error && errorValue.message) ||
    'Cannot reach atheros-search.'
  );
}

const EXAMPLE_QUERIES = [
  'probe requests from unknown devices',
  'deauthentication flood last 24h',
  'rogue AP shadow network',
  'aa:bb:cc:dd:ee:ff',
];

function readLiveStreamPreference(): boolean {
  try {
    const stored = window.localStorage.getItem('atheros-search.live-stream');
    return stored === null ? true : stored === 'true';
  } catch {
    return true;
  }
}

export default function SearchPage() {
  const navigate = useNavigate();
  const [filtersOpen, setFiltersOpen] = createSignal(false);
  const [showAdvanced, setShowAdvanced] = createSignal(false);
  const [useStream, setUseStream] = createSignal(readLiveStreamPreference());
  const [searched, setSearched] = createSignal(false);
  const [lastSearchMs, setLastSearchMs] = createSignal<number | null>(null);
  const [activeResultIndex, setActiveResultIndex] = createSignal(-1);
  const streamSearch = useSearchStream();
  const restoreScroll = useScrollRestoration();
  let abortController: AbortController | null = null;
  let filterButton: HTMLButtonElement | undefined;
  let searchDebounceTimer: number | undefined;

  useSuggest();
  useUrlSync();

  onMount(() => {
    window.scrollTo(0, restoreScroll());
    const initialQuery =
      new URLSearchParams(window.location.search).get('q')?.trim() ?? '';
    if (initialQuery) queueSearch();
  });

  createEffect(() => {
    document.title = query().trim()
      ? `${query().trim()} - atheros search`
      : 'Search - atheros search';
  });

  createEffect(() => {
    try {
      window.localStorage.setItem(
        'atheros-search.live-stream',
        String(useStream()),
      );
    } catch {
      // Preference persistence can be disabled by browser policy.
    }
  });

  const resultMeta = createMemo(() => {
    if (loading()) return 'Searching...';
    if (streaming()) {
      const reconnecting = streamSearch.retrying() ? 'Reconnecting - ' : '';
      return `${reconnecting}Streaming ${results.length} / ${topK()}`;
    }
    if (results.length > 0) {
      const modeLabel =
        meta.mode_used?.replace('SEARCH_MODE_', '').toLowerCase() ??
        mode().replace('SEARCH_MODE_', '').toLowerCase();
      const timing = lastSearchMs() === null ? '' : ` · ${lastSearchMs()} ms`;
      return `${results.length} result${results.length === 1 ? '' : 's'} · ${modeLabel}${timing}`;
    }
    if (searched()) return `No results for "${query()}"`;
    return 'Ready';
  });

  const streamingProgress = createMemo(() =>
    Math.min(100, (results.length / Math.max(1, topK())) * 100),
  );

  const errorCopy = createMemo(() => friendlyError(error() ?? ''));

  createEffect(() => {
    if (results.length === 0) {
      setActiveResultIndex(-1);
      return;
    }

    if (activeResultIndex() >= results.length) {
      setActiveResultIndex(results.length - 1);
    }
  });

  onCleanup(() => window.clearTimeout(searchDebounceTimer));

  function queueSearch() {
    window.clearTimeout(searchDebounceTimer);
    searchDebounceTimer = window.setTimeout(() => {
      void runSearch();
    }, 50);
  }

  async function runSearch() {
    const request = buildSearchRequest();
    if (!request.query) {
      clearResults();
      setSearched(false);
      return;
    }

    pushHistory(request.query);
    setSearched(true);
    setLastSearchMs(null);
    setActiveResultIndex(-1);
    abortController?.abort();
    abortController = null;
    streamSearch.cancel();
    const startedAt = performance.now();

    if (useStream()) {
      await streamSearch.stream(request, describeError);
      setLastSearchMs(Math.round(performance.now() - startedAt));
      return;
    }

    abortController = new AbortController();
    const currentController = abortController;
    setLoading(true);
    setError(null);

    try {
      const response = await api.search(request, currentController.signal);
      replaceResults(response.results ?? []);
      setMeta(response);
    } catch (searchError) {
      if (currentController.signal.aborted) return;
      replaceResults([]);
      setError(describeError(searchError));
    } finally {
      if (abortController === currentController) {
        abortController = null;
        setLoading(false);
        setLastSearchMs(Math.round(performance.now() - startedAt));
      }
    }
  }

  function cancelSearch() {
    streamSearch.cancel();
    abortController?.abort();
    abortController = null;
    window.clearTimeout(searchDebounceTimer);
    searchDebounceTimer = undefined;
    setLoading(false);
  }

  function focusSearch() {
    document.getElementById('search-input')?.focus();
  }

  function focusResult(index: number) {
    const cards = Array.from(
      document.querySelectorAll<HTMLElement>(
        '.result-card:not(.skeleton-card)',
      ),
    );
    if (cards.length === 0) return;
    const next = Math.max(0, Math.min(index, cards.length - 1));
    setActiveResultIndex(next);
    queueMicrotask(() => cards[next]?.focus());
  }

  function openFocusedResult() {
    const active = document.activeElement as HTMLElement | null;
    if (active instanceof HTMLAnchorElement && active.href) {
      active.click();
      return;
    }
    const sourceKey = active?.dataset.sourceKey;
    if (!sourceKey) return;
    navigate(
      `/explain/${encodeURIComponent(sourceKey)}?query=${encodeURIComponent(query())}&kind=${encodeURIComponent(kind())}`,
    );
  }

  useKeyboardShortcuts({
    focusSearch,
    submitSearch: queueSearch,
    toggleFilters: () => setFiltersOpen((value) => !value),
    escape: () => {
      if (shortcutsOpen()) setShortcutsOpen(false);
      else if (filtersOpen()) setFiltersOpen(false);
      else if (query()) setQuery('');
    },
    nextResult: () => focusResult(activeResultIndex() + 1),
    prevResult: () =>
      focusResult(activeResultIndex() <= 0 ? 0 : activeResultIndex() - 1),
    openFocusedResult,
    showHelp: () => setShortcutsOpen(true),
  });

  return (
    <div class="app-layout">
      <FilterPanel
        open={filtersOpen()}
        onClose={() => setFiltersOpen(false)}
        returnFocus={() => filterButton?.focus()}
      />

      <main id="main-content" class="main-content" tabIndex={-1}>
        <section class="search-workspace" aria-labelledby="page-title">
          <div class="page-heading-row">
            <div>
              <h1 id="page-title" class="display">
                Search
              </h1>
              <p class="caption">
                wireless events, devices, behaviours, sequences
              </p>
            </div>
            <button
              ref={filterButton}
              type="button"
              class="btn btn-secondary filter-toggle"
              aria-expanded={filtersOpen()}
              aria-controls="filter-panel"
              onClick={() => setFiltersOpen((value) => !value)}
            >
              <Filter size={16} aria-hidden="true" />
              <span>Filters</span>
            </button>
          </div>

          <div class="search-controls">
            <SearchBar onSubmit={queueSearch} />
            <div class="control-row">
              <div class="control-inline">
                <button
                  type="button"
                  class="btn btn-primary"
                  onClick={queueSearch}
                >
                  <SearchIcon size={16} aria-hidden="true" />
                  <span>Search</span>
                </button>

                <button
                  type="button"
                  class={`btn btn-secondary cancel-btn ${
                    loading() || streaming() ? 'cancel-btn--visible' : ''
                  }`}
                  onClick={cancelSearch}
                  aria-hidden={!(loading() || streaming())}
                  tabIndex={loading() || streaming() ? 0 : -1}
                >
                  <Square size={16} aria-hidden="true" />
                  <span>Cancel</span>
                </button>
              </div>

              <div class="control-secondary">
                <button
                  type="button"
                  class="btn btn-ghost advanced-toggle"
                  aria-expanded={showAdvanced()}
                  onClick={() => setShowAdvanced((value) => !value)}
                >
                  <span>Advanced</span>
                  <ChevronDown
                    size={14}
                    aria-hidden="true"
                    class={showAdvanced() ? 'chevron-up' : ''}
                  />
                </button>

                <label
                  class="switch-inline"
                  title="Stream results as they arrive instead of waiting for the full response"
                >
                  <input
                    type="checkbox"
                    checked={useStream()}
                    onChange={(event) =>
                      setUseStream(event.currentTarget.checked)
                    }
                  />
                  <span>Live stream</span>
                </label>
              </div>

              <Show when={showAdvanced()}>
                <div
                  class="advanced-controls"
                  role="group"
                  aria-label="Advanced search options"
                >
                  <KindSelector />
                  <ModeSelector />
                </div>
              </Show>
            </div>
            <FilterChips />
          </div>

          <Show
            when={
              meta.fallback_reason && meta.fallback_reason.trim().length > 0
            }
          >
            <div class="state-banner state-banner--warn" role="status">
              Embedding backend unavailable - showing keyword results only.{' '}
              {meta.fallback_reason}
            </div>
          </Show>

          <h2
            id="results-heading"
            aria-live="polite"
            aria-atomic="true"
            class="results-meta"
          >
            {resultMeta()}
          </h2>

          <Show when={streaming()}>
            <div
              class="stream-progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={topK()}
              aria-valuenow={Math.min(results.length, topK())}
              aria-label="Streaming result progress"
            >
              <span style={{ width: `${streamingProgress()}%` }} />
            </div>
          </Show>

          <section aria-label="Search results" class="result-surface">
            <Show
              when={error()}
              fallback={
                <Show
                  when={results.length > 0}
                  fallback={
                    <Show
                      when={loading() || streaming()}
                      fallback={
                        <div class="empty-state">
                          <Show
                            when={searched()}
                            fallback={
                              <div class="empty-welcome">
                                <p class="caption">Try searching for:</p>
                                <ul role="list" class="example-queries">
                                  <For each={EXAMPLE_QUERIES}>
                                    {(example) => (
                                      <li>
                                        <button
                                          type="button"
                                          class="example-query-btn"
                                          onClick={() => {
                                            setQuery(example);
                                            queueSearch();
                                          }}
                                        >
                                          {example}
                                        </button>
                                      </li>
                                    )}
                                  </For>
                                </ul>
                              </div>
                            }
                          >
                            <p>
                              No results for "{query()}" - try broadening your
                              search or removing filters.
                            </p>
                          </Show>
                        </div>
                      }
                    >
                      <div class="loading-state" role="status">
                        <SkeletonCard />
                        <SkeletonCard />
                        <SkeletonCard />
                      </div>
                    </Show>
                  }
                >
                  <ol
                    aria-labelledby="results-heading"
                    role="list"
                    class="result-list"
                  >
                    <For each={results}>
                      {(result, index) => (
                        <li>
                          <ResultCard
                            result={result}
                            queryText={query()}
                            kind={kind()}
                            focused={activeResultIndex() === index()}
                          />
                        </li>
                      )}
                    </For>
                  </ol>
                </Show>
              }
            >
              <div class="state-banner state-banner--error" role="alert">
                <strong>{errorCopy().heading}</strong>
                <Show when={errorCopy().detail !== errorCopy().heading}>
                  <p class="caption">{errorCopy().detail}</p>
                </Show>
                <Show when={errorCopy().action}>
                  <p class="caption">{errorCopy().action}</p>
                </Show>
              </div>
            </Show>
          </section>
        </section>
      </main>
    </div>
  );
}
