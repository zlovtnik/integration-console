import { onCleanup, onMount } from 'solid-js';
import { api } from '~/api/client';
import { setSuggestLoaded, setSuggestions } from '~/stores/suggestStore';
import type { SuggestFiltersResponse } from '~/api/types';

const SUGGEST_STORAGE_KEY = 'atheros-search.suggestions';

function isSuggestFiltersResponse(
  value: unknown,
): value is SuggestFiltersResponse {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    Array.isArray(candidate.ssids) &&
    Array.isArray(candidate.location_ids) &&
    Array.isArray(candidate.sensor_ids) &&
    Array.isArray(candidate.frame_subtypes)
  );
}

function persistSuggestions(data: SuggestFiltersResponse) {
  try {
    window.sessionStorage.setItem(SUGGEST_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Storage can be disabled by browser policy.
  }
}

function hydrateSuggestions() {
  try {
    const parsed = JSON.parse(
      window.sessionStorage.getItem(SUGGEST_STORAGE_KEY) ?? 'null',
    ) as unknown;
    if (!isSuggestFiltersResponse(parsed)) return;
    setSuggestions(parsed);
    setSuggestLoaded(true);
  } catch {
    // Ignore invalid stale cache entries.
  }
}

export async function fetchSuggestions(prefix = '', signal?: AbortSignal) {
  try {
    const data = await api.suggestFilters(prefix, signal);
    setSuggestions(data);
    setSuggestLoaded(true);
    persistSuggestions(data);
    return true;
  } catch (error) {
    if (!(error instanceof Error && error.name === 'AbortError')) {
      setSuggestLoaded(false);
    }
    return false;
  }
}

export function useSuggest() {
  let retryTimer: number | undefined;
  const controller = new AbortController();

  onMount(() => {
    hydrateSuggestions();

    void fetchSuggestions('', controller.signal).then((ok) => {
      if (ok || controller.signal.aborted) return;
      retryTimer = window.setTimeout(() => {
        void fetchSuggestions('', controller.signal);
      }, 5_000);
    });
  });

  onCleanup(() => {
    controller.abort();
    window.clearTimeout(retryTimer);
  });
}
