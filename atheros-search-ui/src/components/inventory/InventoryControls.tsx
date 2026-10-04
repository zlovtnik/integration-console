import { For, Show } from 'solid-js';
import {
  inventoryFilters,
  inventoryLoading,
  inventoryViewMode,
  resetInventoryFilters,
  setInventoryFilters,
  setInventoryViewMode,
} from '~/stores/inventoryStore';

function list(value: string) {
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}
export function InventoryControls(props: {
  onRefresh: () => void;
  onResetView: () => void;
}) {
  const preset = () =>
    inventoryFilters.needs_identity_review
      ? 'review'
      : inventoryFilters.registered === true
        ? 'registered'
        : 'all';
  const applied = () =>
    [
      inventoryFilters.query ? 'Search: ' + inventoryFilters.query : '',
      inventoryFilters.owner_ids?.length
        ? 'Owner: ' + inventoryFilters.owner_ids.join(', ')
        : '',
      inventoryFilters.location_ids?.length
        ? 'Location: ' + inventoryFilters.location_ids.join(', ')
        : '',
      inventoryFilters.sensor_ids?.length
        ? 'Sensor: ' + inventoryFilters.sensor_ids.join(', ')
        : '',
      inventoryFilters.observed_after
        ? 'After: ' + inventoryFilters.observed_after
        : '',
      inventoryFilters.observed_before
        ? 'Before: ' + inventoryFilters.observed_before
        : '',
      preset() === 'review'
        ? 'Needs identity review'
        : preset() === 'registered'
          ? 'Registered'
          : 'All identifiers',
      inventoryFilters.tags?.length
        ? 'Tags: ' + inventoryFilters.tags.join(', ')
        : '',
      inventoryFilters.active_only ? 'Active registry rows' : '',
      'Sort: ' + (inventoryFilters.sort ?? 'last_observed'),
    ].filter(Boolean);
  return (
    <div class="report-controls">
      <div class="report-control-grid">
        <label class="field">
          <span>Identifier or name</span>
          <input
            type="search"
            value={inventoryFilters.query ?? ''}
            onInput={(e) => setInventoryFilters('query', e.currentTarget.value)}
          />
        </label>
        <label class="field">
          <span>Owner</span>
          <input
            value={inventoryFilters.owner_ids?.join(', ') ?? ''}
            onInput={(e) =>
              setInventoryFilters('owner_ids', list(e.currentTarget.value))
            }
          />
        </label>
        <label class="field">
          <span>Location</span>
          <input
            value={inventoryFilters.location_ids?.join(', ') ?? ''}
            onInput={(e) =>
              setInventoryFilters('location_ids', list(e.currentTarget.value))
            }
          />
        </label>
        <label class="field">
          <span>Identifiers</span>
          <select
            value={preset()}
            onChange={(e) => {
              setInventoryFilters(
                'registered',
                e.currentTarget.value === 'registered' ? true : undefined,
              );
              setInventoryFilters(
                'needs_identity_review',
                e.currentTarget.value === 'review',
              );
            }}
          >
            <option value="all">All identifiers</option>
            <option value="registered">Registered</option>
            <option value="review">Needs identity review</option>
          </select>
        </label>
      </div>
      <div class="report-toolbar">
        <fieldset class="segmented-control" aria-label="Inventory view">
          <legend class="sr-only">Inventory view</legend>
          <For each={['table', 'graph', 'dedup_queue'] as const}>
            {(view) => (
              <label class="seg-option">
                <input
                  type="radio"
                  name="inventory-view"
                  checked={inventoryViewMode() === view}
                  onChange={() => setInventoryViewMode(view)}
                />
                <span>
                  {view === 'dedup_queue'
                    ? 'Identity review'
                    : view === 'table'
                      ? 'Table'
                      : 'Graph'}
                </span>
              </label>
            )}
          </For>
        </fieldset>
        <Show when={inventoryViewMode() === 'graph'}>
          <label class="field">
            <span>Graph relationships</span>
            <select
              value={inventoryFilters.grouping}
              onChange={(event) =>
                setInventoryFilters(
                  'grouping',
                  event.currentTarget.value as
                    | 'registry'
                    | 'cmdb'
                    | 'similarity',
                )
              }
            >
              <option value="cmdb">Owner / location</option>
              <option value="similarity">Pending similarity</option>
              <option value="registry">Devices only</option>
            </select>
          </label>
        </Show>
        <Show when={inventoryViewMode() !== 'table'}>
          <button
            type="button"
            class="btn btn-secondary"
            disabled={inventoryLoading()}
            onClick={() => props.onRefresh()}
          >
            Refresh
          </button>
          <button
            type="button"
            class="btn btn-secondary"
            onClick={() => props.onResetView()}
          >
            Reset view
          </button>
        </Show>
      </div>
      <details>
        <summary>Advanced</summary>
        <div class="report-control-grid">
          <label class="field">
            <span>Tags</span>
            <input
              value={inventoryFilters.tags?.join(', ') ?? ''}
              onInput={(e) =>
                setInventoryFilters('tags', list(e.currentTarget.value))
              }
            />
          </label>
          <label class="field">
            <span>Minimum candidate score (0 to 1)</span>
            <input
              type="number"
              min="0"
              max="1"
              step="0.05"
              value={inventoryFilters.min_dedup_confidence ?? 0.75}
              onChange={(e) =>
                setInventoryFilters(
                  'min_dedup_confidence',
                  Number(e.currentTarget.value),
                )
              }
            />
          </label>
          <Show when={inventoryViewMode() === 'graph'}>
            <label class="field">
              <span>Graph limit</span>
              <select
                value={
                  inventoryFilters.scope === 'all'
                    ? 'all'
                    : String(inventoryFilters.limit ?? 400)
                }
                onChange={(e) => {
                  setInventoryFilters(
                    'scope',
                    e.currentTarget.value === 'all' ? 'all' : undefined,
                  );
                  setInventoryFilters(
                    'limit',
                    e.currentTarget.value === 'all'
                      ? undefined
                      : Number(e.currentTarget.value),
                  );
                }}
              >
                <option value="all">All (paginated)</option>
                <For each={[100, 200, 400, 800]}>
                  {(limit) => <option value={limit}>{limit}</option>}
                </For>
              </select>
            </label>
          </Show>
          <label>
            <input
              type="checkbox"
              checked={inventoryFilters.active_only ?? false}
              onChange={(e) =>
                setInventoryFilters('active_only', e.currentTarget.checked)
              }
            />{' '}
            Active registry rows (does not imply online)
          </label>
        </div>
      </details>
      <div class="report-toolbar" aria-label="Applied filters">
        <For each={applied()}>
          {(label) => <span class="filter-chip">{label}</span>}
        </For>
        <button
          type="button"
          class="btn btn-secondary"
          onClick={resetInventoryFilters}
        >
          Reset filters
        </button>
      </div>
    </div>
  );
}
