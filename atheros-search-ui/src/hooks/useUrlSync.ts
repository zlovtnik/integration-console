import { useSearchParams } from '@solidjs/router';
import { batch, createEffect, createSignal, onMount } from 'solid-js';
import { reconcile } from 'solid-js/store';
import { isSearchKind, isSearchMode, type SearchFilters } from '~/api/types';
import {
  cleanFilters,
  filters,
  kind,
  minSimilarity,
  mode,
  normalizeSearchKind,
  normalizeSearchMode,
  query,
  setFilters,
  setKind,
  setMinSimilarity,
  setMode,
  setQuery,
  setTopK,
  topK,
} from '~/stores/searchStore';

function asList(value: string | string[] | undefined): string[] | undefined {
  if (!value) return undefined;
  const list = Array.isArray(value) ? value : [value];
  const compact = list.map((item) => item.trim()).filter(Boolean);
  return compact.length > 0 ? compact : undefined;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function useUrlSync() {
  const [params, setParams] = useSearchParams();
  const [ready, setReady] = createSignal(false);

  onMount(() => {
    batch(() => {
      const nextKind = first(params.kind);
      const nextMode = first(params.mode);
      const urlFilters: SearchFilters = {};
      const locationIds = asList(params.loc);
      const sensorIds = asList(params.sensor);
      const frameSubtypes = asList(params.frame);
      const tags = asList(params.tag);
      const mask = first(params.mask);

      if (locationIds) urlFilters.location_ids = locationIds;
      if (sensorIds) urlFilters.sensor_ids = sensorIds;
      if (typeof params.ssid === 'string' && params.ssid) {
        urlFilters.ssid = params.ssid;
      }
      if (typeof params.mac === 'string' && params.mac) {
        urlFilters.source_mac = params.mac;
      }
      if (frameSubtypes) urlFilters.frame_subtypes = frameSubtypes;
      if (typeof params.after === 'string' && params.after) {
        urlFilters.observed_after = params.after;
      }
      if (typeof params.before === 'string' && params.before) {
        urlFilters.observed_before = params.before;
      }
      if (tags) urlFilters.tags = tags;
      if (params.threat) urlFilters.threat_only = first(params.threat) === '1';
      if (params.hs) urlFilters.handshake_only = first(params.hs) === '1';
      if (mask && !Number.isNaN(Number(mask))) {
        urlFilters.security_flags_mask = Number(mask);
      }

      const nextFilters = cleanFilters(urlFilters);

      if (typeof params.q === 'string') setQuery(params.q);
      if (isSearchKind(nextKind)) setKind(normalizeSearchKind(nextKind));
      if (isSearchMode(nextMode)) setMode(normalizeSearchMode(nextMode));
      if (params.k && Number(first(params.k)) > 0)
        setTopK(Number(first(params.k)));
      if (params.min && Number(first(params.min)) >= 0)
        setMinSimilarity(Number(first(params.min)));
      setFilters(reconcile(nextFilters));
      setReady(true);
    });
  });

  createEffect(() => {
    if (!ready()) return;
    const nextFilters = cleanFilters(filters);

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
      mac: nextFilters.source_mac || undefined,
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
