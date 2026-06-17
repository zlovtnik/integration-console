import { useSearchParams } from '@solidjs/router';
import { batch, createEffect, createSignal, onMount } from 'solid-js';
import { reconcile } from 'solid-js/store';
import { isSearchKind, isSearchMode, type SearchFilters } from '~/api/types';
import {
  cleanFilters,
  DEFAULT_MIN_SIMILARITY,
  DEFAULT_SEARCH_KIND,
  DEFAULT_SEARCH_MODE,
  DEFAULT_TOP_K,
  filters,
  kind,
  minSimilarity,
  mode,
  normalizeSearchKind,
  normalizeSearchMode,
  query,
  resetSearchControlsFromUrlDefaults,
  setFilters,
  setKind,
  setMinSimilarity,
  setMode,
  setQuery,
  setTopK,
  topK,
} from '~/stores/searchStore';
import { asRfc3339 } from '~/utils/timestamp';

function asList(value: string | string[] | undefined): string[] | undefined {
  if (!value) return undefined;
  const list = Array.isArray(value) ? value : [value];
  const compact = Array.from(
    new Set(list.map((item) => item.trim()).filter(Boolean)),
  );
  return compact.length > 0 ? compact : undefined;
}

function sourceMacParams(source: SearchFilters): string[] | undefined {
  return asList([source.source_mac ?? '', ...(source.source_macs ?? [])]);
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function useUrlSync() {
  const [params, setParams] = useSearchParams();
  const [ready, setReady] = createSignal(false);

  onMount(() => {
    batch(() => {
      resetSearchControlsFromUrlDefaults();
      const nextKind = first(params.kind);
      const nextMode = first(params.mode);
      const urlFilters: SearchFilters = {};
      const locationIds = asList(params.loc);
      const sensorIds = asList(params.sensor);
      const frameSubtypes = asList(params.frame);
      const tags = asList(params.tag);
      const macs = asList(params.mac);
      const mask = first(params.mask);

      if (locationIds) urlFilters.location_ids = locationIds;
      if (sensorIds) urlFilters.sensor_ids = sensorIds;
      if (typeof params.ssid === 'string' && params.ssid) {
        urlFilters.ssid = params.ssid;
      }
      if (macs) {
        urlFilters.source_macs = macs;
      }
      if (frameSubtypes) urlFilters.frame_subtypes = frameSubtypes;
      const observedAfter =
        typeof params.after === 'string' ? asRfc3339(params.after) : undefined;
      const observedBefore =
        typeof params.before === 'string'
          ? asRfc3339(params.before)
          : undefined;
      if (observedAfter) urlFilters.observed_after = observedAfter;
      if (observedBefore) urlFilters.observed_before = observedBefore;
      if (tags) urlFilters.tags = tags;
      if (params.threat) urlFilters.threat_only = first(params.threat) === '1';
      if (params.hs) urlFilters.handshake_only = first(params.hs) === '1';
      const parsedMask = mask ? Number(mask) : undefined;
      if (parsedMask !== undefined && Number.isFinite(parsedMask)) {
        urlFilters.security_flags_mask = parsedMask;
      }

      const nextFilters = cleanFilters(urlFilters);

      setQuery(typeof params.q === 'string' ? params.q : '');
      setKind(
        isSearchKind(nextKind)
          ? normalizeSearchKind(nextKind)
          : DEFAULT_SEARCH_KIND,
      );
      setMode(
        isSearchMode(nextMode)
          ? normalizeSearchMode(nextMode)
          : DEFAULT_SEARCH_MODE,
      );
      const parsedK = Number(first(params.k));
      setTopK(
        Number.isFinite(parsedK) && parsedK > 0 ? parsedK : DEFAULT_TOP_K,
      );
      const parsedMin = Number(first(params.min));
      setMinSimilarity(
        Number.isFinite(parsedMin) && parsedMin >= 0
          ? parsedMin
          : DEFAULT_MIN_SIMILARITY,
      );
      setFilters(reconcile(nextFilters));
      setReady(true);
    });
  });

  createEffect(() => {
    if (!ready()) return;
    const nextFilters = cleanFilters(filters);
    const macs = sourceMacParams(filters);

    const next: Record<string, string | string[] | undefined> = {
      q: query() || undefined,
      kind:
        normalizeSearchKind(kind()) !== 'SEARCH_KIND_EVENT'
          ? normalizeSearchKind(kind())
          : undefined,
      mode:
        normalizeSearchMode(mode()) !== 'SEARCH_MODE_HYBRID'
          ? normalizeSearchMode(mode())
          : undefined,
      k: topK() !== 20 ? String(topK()) : undefined,
      min: minSimilarity() > 0 ? String(minSimilarity()) : undefined,
      loc: nextFilters.location_ids?.length
        ? nextFilters.location_ids
        : undefined,
      sensor: nextFilters.sensor_ids?.length
        ? nextFilters.sensor_ids
        : undefined,
      ssid: nextFilters.ssid || undefined,
      mac: macs,
      frame: nextFilters.frame_subtypes?.length
        ? nextFilters.frame_subtypes
        : undefined,
      after: nextFilters.observed_after || undefined,
      before: nextFilters.observed_before || undefined,
      threat: nextFilters.threat_only ? '1' : undefined,
      hs: nextFilters.handshake_only ? '1' : undefined,
      mask:
        typeof nextFilters.security_flags_mask === 'number'
          ? String(nextFilters.security_flags_mask)
          : undefined,
      tag: nextFilters.tags?.length ? nextFilters.tags : undefined,
    };

    setParams(next, { replace: true });
  });
}
