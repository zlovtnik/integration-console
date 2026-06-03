import { useNavigate, useSearchParams } from '@solidjs/router';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onMount,
  Show,
} from 'solid-js';
import { Filter, Play, Search as SearchIcon, Square } from 'lucide-solid';
import { ApiError, api } from '~/api/client';
import { FilterChips } from '~/components/FilterChips';
import { FilterPanel } from '~/components/FilterPanel';
import { KindSelector } from '~/components/KindSelector';
import { ModeSelector } from '~/components/ModeSelector';
import { ResultCard } from '~/components/ResultCard';
import { SearchBar } from '~/components/SearchBar';
import { ShortcutsModal } from '~/components/ShortcutsModal';
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
  results,
  setError,
  setLoading,
  setMeta,
  setQuery,
  setResults,
  streaming,
  topK,
} from '~/stores/searchStore';

function describeError(errorValue: unknown): string {
  if (errorValue instanceof ApiError && errorValue.status === 401) {
    return 'Search API authentication failed - check backend credentials or session state.';
  }
  if (errorValue instanceof ApiError)
    return errorValue.message || `API returned ${errorValue.status}.`;
  if (errorValue instanceof Error && errorValue.name === 'AbortError') {
    return 'Search timed out - try a more specific query.';
  }
  return (
    (errorValue instanceof Error && errorValue.message) ||
    'Cannot reach atheros-search - check API_BASE or service health.'
  );
}

export default function SearchPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [filtersOpen, setFiltersOpen] = createSignal(false);
  const [shortcutsOpen, setShortcutsOpen] = createSignal(false);
  const [useStream, setUseStream] = createSignal(true);
  const [searched, setSearched] = createSignal(false);
  const [lastSearchMs, setLastSearchMs] = createSignal<number | null>(null);
  const [activeResultIndex, setActiveResultIndex] = createSignal(-1);
  const [autoRan, setAutoRan] = createSignal(false);
  const streamSearch = useSearchStream();
  const restoreScroll = useScrollRestoration();
  let abortController: AbortController | null = null;

  useSuggest();
  useUrlSync();

  onMount(() => {
    document.title = 'Search - atheros search';
    window.scrollTo(0, restoreScroll());
    if (params.shortcuts === '1') setShortcutsOpen(true);
  });

  createEffect(() => {
    if (!autoRan() && query().trim()) {
      setAutoRan(true);
      void runSearch();
    }
  });

  const resultMeta = createMemo(() => {
    if (loading()) return 'Searching...';
    if (streaming())
      return `Streaming ${results().length} result${results().length === 1 ? '' : 's'}`;
    if (results().length > 0) {
      const modeLabel =
        meta.mode_used?.replace('SEARCH_MODE_', '').toLowerCase() ??
        mode().replace('SEARCH_MODE_', '').toLowerCase();
      const timing = lastSearchMs() === null ? '' : ` · ${lastSearchMs()} ms`;
      return `${results().length} result${results().length === 1 ? '' : 's'} · ${modeLabel}${timing}`;
    }
    if (searched()) return `No results for "${query()}"`;
    return 'Ready';
  });

  const skeletons = createMemo(() =>
    Array.from(
      { length: Math.max(3, Math.min(topK(), 8)) },
      (_, index) => index,
    ),
  );

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
      setResults(response.results ?? []);
      setMeta(response);
    } catch (searchError) {
      setResults([]);
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
    setLoading(false);
  }

  function focusSearch() {
    document.getElementById('search-input')?.focus();
  }

  function focusResult(index: number) {
    const explainLinks = Array.from(
      document.querySelectorAll<HTMLElement>(
        '.result-card:not(.skeleton-card) .card-actions a',
      ),
    );
    if (explainLinks.length === 0) return;
    const next = Math.max(0, Math.min(index, explainLinks.length - 1));
    setActiveResultIndex(next);
    explainLinks[next]?.focus();
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
    submitSearch: () => void runSearch(),
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
      <FilterPanel open={filtersOpen()} onClose={() => setFiltersOpen(false)} />

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
              type="button"
              class="btn btn-secondary"
              aria-expanded={filtersOpen()}
              aria-controls="filter-panel"
              onClick={() => setFiltersOpen((value) => !value)}
            >
              <Filter size={16} aria-hidden="true" />
              <span>Filters</span>
            </button>
          </div>

          <div class="search-controls">
            <SearchBar onSubmit={() => void runSearch()} />
            <div class="control-row">
              <KindSelector />
              <ModeSelector />
              <label class="switch-inline">
                <input
                  type="checkbox"
                  checked={useStream()}
                  onChange={(event) =>
                    setUseStream(event.currentTarget.checked)
                  }
                />
                <span>Live</span>
              </label>
              <button
                type="button"
                class="btn btn-primary"
                onClick={() => void runSearch()}
              >
                <SearchIcon size={16} aria-hidden="true" />
                <span>Search</span>
              </button>
              <Show when={loading() || streaming()}>
                <button
                  type="button"
                  class="btn btn-secondary"
                  onClick={cancelSearch}
                >
                  <Show
                    when={streaming()}
                    fallback={<Play size={16} aria-hidden="true" />}
                  >
                    <Square size={16} aria-hidden="true" />
                  </Show>
                  <span>Cancel</span>
                </button>
              </Show>
            </div>
            <FilterChips />
          </div>

          <Show when={meta.fallback_reason}>
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

          <section aria-label="Search results" class="result-surface">
            <Show
              when={error()}
              fallback={
                <Show
                  when={streaming()}
                  fallback={
                    <Show
                      when={loading()}
                      fallback={
                        <Show
                          when={results().length > 0}
                          fallback={
                            <div class="empty-state">
                              <Show
                                when={searched()}
                                fallback={
                                  <p>
                                    Start searching with a query or MAC address.
                                  </p>
                                }
                              >
                                <p>No results for "{query()}".</p>
                              </Show>
                            </div>
                          }
                        >
                          <ol
                            aria-labelledby="results-heading"
                            role="list"
                            class="result-list"
                          >
                            <For each={results()}>
                              {(result) => (
                                <li>
                                  <ResultCard
                                    result={result}
                                    queryText={query()}
                                    kind={kind()}
                                  />
                                </li>
                              )}
                            </For>
                          </ol>
                        </Show>
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
                    <For each={skeletons()}>
                      {(_, index) => (
                        <li>
                          <Show
                            when={results()[index()]}
                            fallback={<SkeletonCard />}
                          >
                            {(result) => (
                              <ResultCard
                                result={result()}
                                queryText={query()}
                                kind={kind()}
                              />
                            )}
                          </Show>
                        </li>
                      )}
                    </For>
                  </ol>
                </Show>
              }
            >
              <div class="state-banner state-banner--error" role="alert">
                {error()}
              </div>
            </Show>
          </section>
        </section>
      </main>

      <ShortcutsModal
        open={shortcutsOpen()}
        onClose={() => setShortcutsOpen(false)}
      />
    </div>
  );
}
