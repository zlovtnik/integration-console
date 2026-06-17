import { For } from 'solid-js';
import { LocateFixed, RefreshCw, RotateCcw } from 'lucide-solid';
import {
  INVENTORY_LIMITS,
  inventoryFilters,
  inventoryLoading,
  inventoryMeta,
  inventoryViewMode,
  resetInventoryFilters,
  setInventoryFilters,
  setInventoryViewMode,
} from '~/stores/inventoryStore';
import type { InventoryFilters } from '~/api/types';

const GROUPINGS: {
  value: InventoryFilters['grouping'];
  label: string;
  title: string;
}[] = [
  {
    value: 'registry',
    label: 'Registry',
    title: 'Known devices, active and inactive',
  },
  {
    value: 'cmdb',
    label: 'CMDB',
    title: 'Owner and location relationships',
  },
  {
    value: 'similarity',
    label: 'Similarity',
    title: 'Fingerprint clusters and merge candidates',
  },
];

function splitList(value: string): string[] | undefined {
  const values = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return values.length > 0 ? values : undefined;
}

function joinList(value: string[] | undefined): string {
  return value?.join(', ') ?? '';
}

function limitIndex(): number {
  const index = INVENTORY_LIMITS.indexOf(
    (inventoryFilters.limit ?? 400) as (typeof INVENTORY_LIMITS)[number],
  );
  return index >= 0 ? index : 2;
}

function confidencePercent(): string {
  return Math.round(
    (inventoryFilters.min_dedup_confidence ?? 0) * 100,
  ).toString();
}

export function InventoryControls(props: {
  onRefresh: () => void;
  onResetView: () => void;
}) {
  function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    props.onRefresh();
  }

  return (
    <form class="graph-controls inventory-controls" onSubmit={handleSubmit}>
      <div class="graph-control-grid inventory-control-grid">
        <label class="field graph-field">
          <span>Owners</span>
          <input
            value={joinList(inventoryFilters.owner_ids)}
            placeholder="security, facilities"
            onInput={(event) =>
              setInventoryFilters(
                'owner_ids',
                splitList(event.currentTarget.value),
              )
            }
          />
        </label>

        <label class="field graph-field">
          <span>Locations</span>
          <input
            value={joinList(inventoryFilters.location_ids)}
            placeholder="lab-east, floor-2"
            onInput={(event) =>
              setInventoryFilters(
                'location_ids',
                splitList(event.currentTarget.value),
              )
            }
          />
        </label>

        <label class="field graph-field">
          <span>Tags</span>
          <input
            value={joinList(inventoryFilters.tags)}
            placeholder="printer, managed"
            onInput={(event) =>
              setInventoryFilters('tags', splitList(event.currentTarget.value))
            }
          />
        </label>

        <label class="field graph-field">
          <span>Confidence {confidencePercent()}%</span>
          <input
            type="range"
            min="0"
            max="100"
            step="5"
            value={confidencePercent()}
            onInput={(event) =>
              setInventoryFilters(
                'min_dedup_confidence',
                Number(event.currentTarget.value) / 100,
              )
            }
          />
        </label>
      </div>

      <fieldset
        class="segmented-control inventory-grouping"
        role="radiogroup"
        aria-label="Inventory grouping"
      >
        <legend class="sr-only">Inventory grouping</legend>
        <For each={GROUPINGS}>
          {(option) => (
            <label class="seg-option" title={option.title}>
              <input
                type="radio"
                name="inventory-grouping"
                value={option.value}
                checked={inventoryFilters.grouping === option.value}
                onChange={() => setInventoryFilters('grouping', option.value)}
              />
              <span>{option.label}</span>
            </label>
          )}
        </For>
      </fieldset>

      <div class="graph-actions inventory-actions">
        <fieldset
          class="segmented-control inventory-view-mode"
          role="radiogroup"
          aria-label="Inventory view"
        >
          <legend class="sr-only">Inventory view</legend>
          <label class="seg-option">
            <input
              type="radio"
              name="inventory-view"
              checked={inventoryViewMode() === 'graph'}
              onChange={() => setInventoryViewMode('graph')}
            />
            <span>Graph</span>
          </label>
          <label class="seg-option">
            <input
              type="radio"
              name="inventory-view"
              checked={inventoryViewMode() === 'dedup_queue'}
              onChange={() => setInventoryViewMode('dedup_queue')}
            />
            <span>Queue</span>
          </label>
        </fieldset>

        <label class="switch-inline">
          <input
            type="checkbox"
            checked={inventoryFilters.active_only ?? false}
            onChange={(event) =>
              setInventoryFilters(
                'active_only',
                event.currentTarget.checked || undefined,
              )
            }
          />
          <span>Active only</span>
        </label>

        <label class="field graph-limit-field">
          <span>Limit {inventoryFilters.limit ?? 400}</span>
          <input
            type="range"
            min="0"
            max={String(INVENTORY_LIMITS.length - 1)}
            step="1"
            value={limitIndex()}
            onInput={(event) =>
              setInventoryFilters(
                'limit',
                INVENTORY_LIMITS[Number(event.currentTarget.value)] ?? 400,
              )
            }
          />
        </label>

        <span class="graph-stat" aria-live="polite">
          <strong>{inventoryMeta.node_count ?? 0}</strong> nodes
          <strong>{inventoryMeta.edge_count ?? 0}</strong> edges
          <strong>{inventoryMeta.total_registered_count ?? 0}</strong> devices
        </span>

        <button
          type="button"
          class="btn btn-secondary"
          onClick={() => props.onResetView()}
        >
          <LocateFixed size={16} aria-hidden="true" />
          <span>Reset view</span>
        </button>

        <button
          type="button"
          class="btn btn-secondary"
          onClick={() => resetInventoryFilters()}
        >
          <RotateCcw size={16} aria-hidden="true" />
          <span>Reset filters</span>
        </button>

        <button
          type="submit"
          class="btn btn-primary"
          disabled={inventoryLoading()}
        >
          <RefreshCw size={16} aria-hidden="true" />
          <span>{inventoryLoading() ? 'Loading' : 'Refresh'}</span>
        </button>
      </div>
    </form>
  );
}
