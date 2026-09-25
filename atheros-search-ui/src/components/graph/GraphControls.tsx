import { For, createSignal } from 'solid-js';
import { LocateFixed, RefreshCw, Star, Trash2 } from 'lucide-solid';
import {
  GRAPH_EDGE_KINDS,
  GRAPH_LIMITS,
  GRAPH_NODE_KINDS,
  applyGraphSavedView,
  deleteGraphSavedView,
  graphFilters,
  graphLoading,
  graphMeta,
  loadGraphSavedViews,
  saveCurrentGraphView,
  setGraphEdgeKindVisibility,
  setGraphFilters,
  setGraphKindVisibility,
  visibleGraphEdgeKinds,
  visibleGraphKinds,
  type GraphSavedView,
} from '~/stores/graphStore';
import { suggestions } from '~/stores/suggestStore';
import { edgeKindLabel, nodeKindLabel } from '~/hooks/useForceGraph';
import type { EdgeKind, NodeKind } from '~/api/types';
import {
  localInputToRfc3339,
  rfc3339ToLocalInput,
} from '~/utils/timestamp';

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
  const index = GRAPH_LIMITS.indexOf(
    (graphFilters.limit ?? 200) as (typeof GRAPH_LIMITS)[number],
  );
  return index >= 0 ? index : 2;
}

export function GraphControls(props: {
  onRefresh: () => void;
  onResetView: () => void;
}) {
  const [savedViews, setSavedViews] = createSignal<GraphSavedView[]>(
    loadGraphSavedViews(),
  );
  const [viewName, setViewName] = createSignal('');

  function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    props.onRefresh();
  }

  function handleKind(kind: NodeKind, checked: boolean) {
    setGraphKindVisibility(kind, checked);
  }

  function handleEdgeKind(kind: EdgeKind, checked: boolean) {
    setGraphEdgeKindVisibility(kind, checked);
  }

  function handleSaveView(event: SubmitEvent) {
    event.preventDefault();
    if (!viewName().trim()) return;
    setSavedViews(saveCurrentGraphView(viewName()));
    setViewName('');
  }

  function handleApplyView(view: GraphSavedView) {
    applyGraphSavedView(view);
    props.onRefresh();
  }

  function handleDeleteView(view: GraphSavedView) {
    setSavedViews(deleteGraphSavedView(view.name));
  }

  return (
    <form class="graph-controls" onSubmit={handleSubmit}>
      <div class="graph-control-grid">
        <label class="field graph-field">
          <span>Locations</span>
          <input
            value={joinList(graphFilters.location_ids)}
            list="graph-location-suggestions"
            placeholder="lab, floor-2"
            onInput={(event) =>
              setGraphFilters(
                'location_ids',
                splitList(event.currentTarget.value),
              )
            }
          />
        </label>
        <datalist id="graph-location-suggestions">
          <For each={suggestions.location_ids}>
            {(item) => <option value={item} />}
          </For>
        </datalist>

        <label class="field graph-field">
          <span>Sensors</span>
          <input
            value={joinList(graphFilters.sensor_ids)}
            list="graph-sensor-suggestions"
            placeholder="sensor-a, sensor-b"
            onInput={(event) =>
              setGraphFilters('sensor_ids', splitList(event.currentTarget.value))
            }
          />
        </label>
        <datalist id="graph-sensor-suggestions">
          <For each={suggestions.sensor_ids}>
            {(item) => <option value={item} />}
          </For>
        </datalist>

        <label class="field graph-field">
          <span>Source MAC</span>
          <input
            value={graphFilters.source_mac ?? ''}
            inputMode="text"
            placeholder="aa:bb:cc:dd:ee:ff"
            onInput={(event) =>
              setGraphFilters(
                'source_mac',
                event.currentTarget.value.trim() || undefined,
              )
            }
          />
        </label>

        <label class="field graph-field">
          <span>SSID</span>
          <input
            value={graphFilters.ssid ?? ''}
            list="graph-ssid-suggestions"
            placeholder="corp-wifi"
            onInput={(event) =>
              setGraphFilters(
                'ssid',
                event.currentTarget.value.trim() || undefined,
              )
            }
          />
        </label>
        <datalist id="graph-ssid-suggestions">
          <For each={suggestions.ssids}>{(item) => <option value={item} />}</For>
        </datalist>

        <label class="field graph-field graph-field--date">
          <span>After</span>
          <input
            type="datetime-local"
            value={rfc3339ToLocalInput(graphFilters.observed_after)}
            onInput={(event) =>
              setGraphFilters(
                'observed_after',
                localInputToRfc3339(event.currentTarget.value),
              )
            }
          />
        </label>

        <label class="field graph-field graph-field--date">
          <span>Before</span>
          <input
            type="datetime-local"
            value={rfc3339ToLocalInput(graphFilters.observed_before)}
            onInput={(event) =>
              setGraphFilters(
                'observed_before',
                localInputToRfc3339(event.currentTarget.value),
              )
            }
          />
        </label>
      </div>

      <fieldset class="graph-kind-filter">
        <legend>Node types</legend>
        <For each={GRAPH_NODE_KINDS}>
          {(kind) => (
            <label class="graph-kind-check">
              <input
                type="checkbox"
                checked={visibleGraphKinds().has(kind)}
                onChange={(event) => handleKind(kind, event.currentTarget.checked)}
              />
              <span>{nodeKindLabel(kind)}</span>
            </label>
          )}
        </For>
      </fieldset>

      <fieldset class="graph-kind-filter">
        <legend>Edge types</legend>
        <For each={GRAPH_EDGE_KINDS}>
          {(kind) => (
            <label class="graph-kind-check">
              <input
                type="checkbox"
                checked={visibleGraphEdgeKinds().has(kind)}
                onChange={(event) =>
                  handleEdgeKind(kind, event.currentTarget.checked)
                }
              />
              <span>{edgeKindLabel(kind)}</span>
            </label>
          )}
        </For>
      </fieldset>

      <fieldset class="graph-kind-filter graph-saved-views">
        <legend>Saved views</legend>
        <For
          each={savedViews()}
          fallback={<p class="graph-panel-empty">No saved views yet.</p>}
        >
          {(view) => (
            <span class="graph-saved-view">
              <button
                type="button"
                class="btn btn-secondary btn-saved-view"
                onClick={() => handleApplyView(view)}
              >
                <Star size={14} aria-hidden="true" />
                <span>{view.name}</span>
              </button>
              <button
                type="button"
                class="icon-btn"
                aria-label={`Delete saved view ${view.name}`}
                onClick={() => handleDeleteView(view)}
              >
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </span>
          )}
        </For>
        <label class="field graph-field graph-field--save-view">
          <span>View name</span>
          <input
            value={viewName()}
            placeholder="lab 24h threats"
            onInput={(event) => setViewName(event.currentTarget.value)}
          />
        </label>
        <button
          type="button"
          class="btn btn-secondary"
          disabled={!viewName().trim()}
          onClick={(event) => handleSaveView(event as unknown as SubmitEvent)}
        >
          Save current filters
        </button>
      </fieldset>

      <div class="graph-actions">
        <label class="field graph-field graph-field--hops">
          <span>Hops {graphFilters.hops === 2 ? '2' : '1'}</span>
          <input
            type="range"
            min="1"
            max="2"
            step="1"
            value={graphFilters.hops === 2 ? '2' : '1'}
            onInput={(event) =>
              setGraphFilters(
                'hops',
                Number(event.currentTarget.value) === 2 ? 2 : undefined,
              )
            }
          />
        </label>

        <label class="switch-inline">
          <input
            type="checkbox"
            checked={graphFilters.threat_only ?? false}
            onChange={(event) =>
              setGraphFilters('threat_only', event.currentTarget.checked || undefined)
            }
          />
          <span>Threat only</span>
        </label>

        <label class="field graph-limit-field">
          <span>Limit {graphFilters.limit ?? 200}</span>
          <input
            type="range"
            min="0"
            max={String(GRAPH_LIMITS.length - 1)}
            step="1"
            value={limitIndex()}
            onInput={(event) =>
              setGraphFilters(
                'limit',
                GRAPH_LIMITS[Number(event.currentTarget.value)] ?? 200,
              )
            }
          />
        </label>

        <span class="graph-stat" aria-live="polite">
          <strong>{graphMeta.node_count ?? 0}</strong> nodes
          <strong>{graphMeta.edge_count ?? 0}</strong> edges
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
          type="submit"
          class="btn btn-primary"
          disabled={graphLoading()}
        >
          <RefreshCw size={16} aria-hidden="true" />
          <span>{graphLoading() ? 'Loading' : 'Refresh'}</span>
        </button>
      </div>
    </form>
  );
}
