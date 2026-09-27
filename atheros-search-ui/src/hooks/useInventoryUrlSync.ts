import { useSearchParams } from '@solidjs/router';
import { batch, createEffect, createSignal, on, untrack } from 'solid-js';
import { reconcile } from 'solid-js/store';
import type { InventoryFilters } from '~/api/types';
import { asRfc3339 } from '~/utils/timestamp';
import {
  INVENTORY_SCOPE_ALL,
  inventoryFilters,
  inventoryViewMode,
  setInventoryFilters,
  setInventoryViewMode,
  setSelectedInventoryNodeId,
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
  return value === 'dedup_queue' || value === 'graph' ? value : 'table';
}

export function useInventoryUrlSync() {
  const [params, setParams] = useSearchParams();
  const [ready, setReady] = createSignal(false);

  let writing = false;
  createEffect(
    on(
      () => JSON.stringify(params),
      () => {
        if (writing) return;
        batch(() => {
          const parsedLimit = Number(first(params.limit));
          const parsedMin = Number(first(params.min));
          // A bookmarked numeric limit is preserved exactly; otherwise the
          // default scope covers every device in the filtered inventory.
          const hasNumericLimit =
            Number.isFinite(parsedLimit) &&
            parsedLimit > 0 &&
            first(params.limit) !== undefined;
          const nextFilters: InventoryFilters = {
            grouping: grouping(first(params.grouping)),
            min_dedup_confidence:
              Number.isFinite(parsedMin) && parsedMin >= 0
                ? parsedMin
                : DEFAULT_MIN_DEDUP_CONFIDENCE,
          };
          if (hasNumericLimit) {
            nextFilters.limit = parsedLimit;
          } else {
            nextFilters.scope = INVENTORY_SCOPE_ALL;
          }
          const locationIds = asList(params.loc);
          const ownerIds = asList(params.owner);
          const tags = asList(params.tag);

          if (locationIds) nextFilters.location_ids = locationIds;
          if (ownerIds) nextFilters.owner_ids = ownerIds;
          if (tags) nextFilters.tags = tags;
          if (params.active)
            nextFilters.active_only = first(params.active) === '1';
          if (first(params.q)) nextFilters.query = first(params.q)!;
          if (first(params.preset) === 'registered')
            nextFilters.registered = true;
          if (first(params.preset) === 'review')
            nextFilters.needs_identity_review = true;
          nextFilters.sort =
            first(params.sort) === 'identifier'
              ? 'identifier'
              : 'last_observed';
          const sensors = asList(params.sensor);
          if (sensors) nextFilters.sensor_ids = sensors;
          const macs = asList(params.mac);
          if (macs) nextFilters.source_macs = macs;
          const after = first(params.after);
          const before = first(params.before);
          const validAfter = asRfc3339(after ?? '');
          const validBefore = asRfc3339(before ?? '');
          if (validAfter) nextFilters.observed_after = validAfter;
          if (validBefore) nextFilters.observed_before = validBefore;

          setInventoryFilters(reconcile(nextFilters));
          setInventoryViewMode(viewMode(first(params.view)));
          setSelectedInventoryNodeId(first(params.node) ?? null);
          setReady(true);
        });
      },
    ),
  );

  createEffect(() => {
    if (!ready()) return;
    const next: Record<string, string | string[] | undefined> = {
      q: inventoryFilters.query || undefined,
      preset: inventoryFilters.needs_identity_review
        ? 'review'
        : inventoryFilters.registered === true
          ? 'registered'
          : undefined,
      sort: inventoryFilters.sort === 'identifier' ? 'identifier' : undefined,
      sensor: inventoryFilters.sensor_ids,
      mac: inventoryFilters.source_macs,
      after: inventoryFilters.observed_after,
      before: inventoryFilters.observed_before,
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
        inventoryFilters.limit !== undefined
          ? String(inventoryFilters.limit)
          : undefined,
      view: inventoryViewMode() === 'table' ? undefined : inventoryViewMode(),
    };

    writing = true;
    untrack(() => setParams(next, { replace: true }));
    queueMicrotask(() => {
      writing = false;
    });
  });

  return { ready };
}
