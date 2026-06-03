import { useSearchParams } from '@solidjs/router';
import { batch, createEffect, createSignal, onMount } from 'solid-js';
import { isSearchKind, isSearchMode } from '~/api/types';
import {
  filters,
  kind,
  minSimilarity,
  mode,
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
      if (typeof params.q === 'string') setQuery(params.q);
      if (isSearchKind(nextKind)) setKind(nextKind);
      if (isSearchMode(nextMode)) setMode(nextMode);
      if (params.k && Number(first(params.k)) > 0) setTopK(Number(first(params.k)));
      if (params.min && Number(first(params.min)) >= 0) setMinSimilarity(Number(first(params.min)));
      if (params.loc) setFilters('location_ids', asList(params.loc));
      if (params.sensor) setFilters('sensor_ids', asList(params.sensor));
      if (typeof params.ssid === 'string') setFilters('ssid', params.ssid);
      if (typeof params.mac === 'string') setFilters('source_mac', params.mac);
      if (params.frame) setFilters('frame_subtypes', asList(params.frame));
      if (typeof params.after === 'string') setFilters('observed_after', params.after);
      if (typeof params.before === 'string') setFilters('observed_before', params.before);
      if (params.tag) setFilters('tags', asList(params.tag));
      if (params.threat) setFilters('threat_only', first(params.threat) === '1');
      if (params.hs) setFilters('handshake_only', first(params.hs) === '1');
      if (params.mask && !Number.isNaN(Number(first(params.mask)))) {
        setFilters('security_flags_mask', Number(first(params.mask)));
      }
      setReady(true);
    });
  });

  createEffect(() => {
    if (!ready()) return;

    const next: Record<string, string | string[] | undefined> = {
      q: query() || undefined,
      kind: kind() !== 'SEARCH_KIND_EVENT' ? kind() : undefined,
      mode: mode() !== 'SEARCH_MODE_HYBRID' ? mode() : undefined,
      k: topK() !== 20 ? String(topK()) : undefined,
      min: minSimilarity() > 0 ? String(minSimilarity()) : undefined,
      loc: filters.location_ids?.length ? filters.location_ids : undefined,
      sensor: filters.sensor_ids?.length ? filters.sensor_ids : undefined,
      ssid: filters.ssid || undefined,
      mac: filters.source_mac || undefined,
      frame: filters.frame_subtypes?.length ? filters.frame_subtypes : undefined,
      after: filters.observed_after || undefined,
      before: filters.observed_before || undefined,
      threat: filters.threat_only ? '1' : undefined,
      hs: filters.handshake_only ? '1' : undefined,
      mask:
        typeof filters.security_flags_mask === 'number'
          ? String(filters.security_flags_mask)
          : undefined,
      tag: filters.tags?.length ? filters.tags : undefined,
    };

    setParams(next, { replace: true });
  });
}
