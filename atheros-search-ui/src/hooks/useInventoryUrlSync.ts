import { useSearchParams } from '@solidjs/router';
import { batch, createEffect, createSignal, onMount } from 'solid-js';
import { reconcile } from 'solid-js/store';
import type { InventoryFilters } from '~/api/types';
import {
  inventoryFilters,
  inventoryViewMode,
  setInventoryFilters,
  setInventoryViewMode,
  type InventoryViewMode,
} from '~/stores/inventoryStore';

const DEFAULT_MIN_DEDUP_CONFIDENCE = 0.75;

function asList(value: string | string[] | undefined): string[] | undefined {
  if (!value) return undefined;
  const list = Array.isArray(value) ? value : [value];
  const compact = Array.from(
    new Set(list.map((item) => item.trim()).filter(Boolean)),
  );
  return compact.length > 0 ? compact : undefined;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function grouping(value: string | undefined): InventoryFilters['grouping'] {
  return value === 'cmdb' || value === 'similarity' ? value : 'registry';
}

function viewMode(value: string | undefined): InventoryViewMode {
  return value === 'dedup_queue' ? 'dedup_queue' : 'graph';
}

export function useInventoryUrlSync() {
  const [params, setParams] = useSearchParams();
  const [ready, setReady] = createSignal(false);

  onMount(() => {
    batch(() => {
      const parsedLimit = Number(first(params.limit));
      const parsedMin = Number(first(params.min));
      const nextFilters: InventoryFilters = {
        grouping: grouping(first(params.grouping)),
        limit:
          Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 400,
        min_dedup_confidence:
          Number.isFinite(parsedMin) && parsedMin >= 0
            ? parsedMin
            : DEFAULT_MIN_DEDUP_CONFIDENCE,
      };
      const locationIds = asList(params.loc);
      const ownerIds = asList(params.owner);
      const tags = asList(params.tag);

      if (locationIds) nextFilters.location_ids = locationIds;
      if (ownerIds) nextFilters.owner_ids = ownerIds;
      if (tags) nextFilters.tags = tags;
      if (params.active) nextFilters.active_only = first(params.active) === '1';

      setInventoryFilters(reconcile(nextFilters));
      setInventoryViewMode(viewMode(first(params.view)));
      setReady(true);
    });
  });

  createEffect(() => {
    if (!ready()) return;
    const next: Record<string, string | string[] | undefined> = {
      grouping:
        inventoryFilters.grouping === 'registry'
          ? undefined
          : inventoryFilters.grouping,
      loc: inventoryFilters.location_ids?.length
        ? inventoryFilters.location_ids
        : undefined,
      owner: inventoryFilters.owner_ids?.length
        ? inventoryFilters.owner_ids
        : undefined,
      active: inventoryFilters.active_only ? '1' : undefined,
      min:
        (inventoryFilters.min_dedup_confidence ??
          DEFAULT_MIN_DEDUP_CONFIDENCE) !== DEFAULT_MIN_DEDUP_CONFIDENCE
          ? String(inventoryFilters.min_dedup_confidence)
          : undefined,
      tag: inventoryFilters.tags?.length ? inventoryFilters.tags : undefined,
      limit:
        (inventoryFilters.limit ?? 400) !== 400
          ? String(inventoryFilters.limit)
          : undefined,
      view:
        inventoryViewMode() === 'dedup_queue' ? inventoryViewMode() : undefined,
    };

    setParams(next, { replace: true });
  });

  return { ready };
}
