import { For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import {
  ChevronDown,
  LocateFixed,
  RefreshCw,
  Star,
  Trash2,
} from 'lucide-solid';
import {
  GRAPH_EDGE_KINDS,
  GRAPH_LIMITS,
  GRAPH_NODE_KINDS,
  GRAPH_SCOPE_ALL,
  applyGraphSavedView,
  deleteGraphSavedView,
  graphCoverage,
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
import {
  edgeColor,
  edgeKindLabel,
  nodeColor,
  nodeKindLabel,
} from '~/hooks/useForceGraph';
import type { EdgeKind, NodeKind } from '~/api/types';
import { localInputToRfc3339, rfc3339ToLocalInput } from '~/utils/timestamp';

type GraphMenuId = 'edges' | 'views';

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

function coverageLabel(): string {
  const coverage = graphCoverage();
  if (!coverage) return '';
  if (coverage.complete && coverage.totalNodes > 0) {
    return `All ${coverage.totalNodes} loaded`;
  }
  if (coverage.totalNodes > 0) {
    return `${coverage.loadedNodes} / ${coverage.totalNodes} loaded`;
  }
  return `${coverage.loadedNodes} loaded`;
}

function NodeKindChip(props: { kind: NodeKind }) {
  return (
    <button
      type="button"
      class="graph-kind-chip"
      aria-pressed={visibleGraphKinds().has(props.kind)}
      onClick={() => setGraphKindVisibility(props.kind)}
    >
      <span
        class="graph-kind-chip-swatch"
        style={{ background: nodeColor({ kind: props.kind }) }}
        aria-hidden="true"
      />
      <span>{nodeKindLabel(props.kind)}</span>
    </button>
  );
}

function EdgeKindChip(props: { kind: EdgeKind }) {
  return (
    <button
      type="button"
      class="graph-kind-chip"
      aria-pressed={visibleGraphEdgeKinds().has(props.kind)}
      onClick={() => setGraphEdgeKindVisibility(props.kind)}
    >
      <span
        class="graph-kind-chip-swatch graph-kind-chip-swatch--edge"
        style={{ background: edgeColor(props.kind) }}
        aria-hidden="true"
      />
      <span>{edgeKindLabel(props.kind)}</span>
    </button>
  );
}

export function GraphControls(props: {
  onRefresh: () => void;
  onResetView: () => void;
}) {
  let rootRef: HTMLFormElement | undefined;
  const [savedViews, setSavedViews] = createSignal<GraphSavedView[]>(
    loadGraphSavedViews(),
  );
  const [viewName, setViewName] = createSignal('');
  const [openMenu, setOpenMenu] = createSignal<GraphMenuId | null>(null);

  onMount(() => {
    function handlePointerDown(event: PointerEvent) {
      if (openMenu() === null) return;
      const target = event.target;
      if (target instanceof Node && rootRef?.contains(target)) return;
      setOpenMenu(null);
    }

    function handleKeydown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || openMenu() === null) return;
      setOpenMenu(null);
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeydown);
    onCleanup(() => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeydown);
    });
  });

  function toggleMenu(menu: GraphMenuId) {
    setOpenMenu((current) => (current === menu ? null : menu));
  }

  function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    props.onRefresh();
  }

  function handleSaveView() {
    if (!viewName().trim()) return;
    setSavedViews(saveCurrentGraphView(viewName()));
    setViewName('');
  }

  function handleViewNameKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    handleSaveView();
  }

  function handleApplyView(view: GraphSavedView) {
    applyGraphSavedView(view);
    setOpenMenu(null);
    props.onRefresh();
  }

  function handleDeleteView(view: GraphSavedView) {
    setSavedViews(deleteGraphSavedView(view.name));
  }

  return (
    <form class="graph-controls" onSubmit={handleSubmit} ref={rootRef}>
      <section
        class="graph-section graph-section--search"
        aria-labelledby="graph-section-search-label"
      >
        <div class="graph-section-head">
          <span class="graph-section-label" id="graph-section-search-label">
            Search
          </span>
        </div>

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
                setGraphFilters(
                  'sensor_ids',
                  splitList(event.currentTarget.value),
                )
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
            <For each={suggestions.ssids}>
              {(item) => <option value={item} />}
            </For>
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
      </section>

      <section
        class="graph-section graph-section--view"
        aria-labelledby="graph-section-view-label"
      >
        <div class="graph-section-head">
          <span class="graph-section-label" id="graph-section-view-label">
            View
          </span>
        </div>

        <div class="graph-view-row">
          <div class="graph-chip-row" role="group" aria-label="Node types">
            <For each={GRAPH_NODE_KINDS}>
              {(kind) => <NodeKindChip kind={kind} />}
            </For>
          </div>

          <div class="graph-popover-anchor">
            <button
              type="button"
              class="btn btn-ghost graph-dropdown-trigger"
              aria-expanded={openMenu() === 'edges'}
              aria-controls="graph-edge-menu"
              onClick={() => toggleMenu('edges')}
            >
              <span>Edges</span>
              <span class="graph-dropdown-count">
                {`${visibleGraphEdgeKinds().size}/${GRAPH_EDGE_KINDS.length}`}
              </span>
              <ChevronDown size={14} aria-hidden="true" />
            </button>
            <Show when={openMenu() === 'edges'}>
              <div
                class="graph-popover"
                id="graph-edge-menu"
                role="group"
                aria-label="Edge types"
              >
                <For each={GRAPH_EDGE_KINDS}>
                  {(kind) => <EdgeKindChip kind={kind} />}
                </For>
              </div>
            </Show>
          </div>

          <fieldset
            class="segmented-control graph-hops"
            role="radiogroup"
            aria-label="Hops"
          >
            <legend class="sr-only">Hops</legend>
            <label class="seg-option">
              <input
                type="radio"
                name="graph-hops"
                checked={(graphFilters.hops ?? 1) !== 2}
                onChange={() => setGraphFilters('hops', undefined)}
              />
              <span>1 hop</span>
            </label>
            <label class="seg-option">
              <input
                type="radio"
                name="graph-hops"
                checked={graphFilters.hops === 2}
                onChange={() => setGraphFilters('hops', 2)}
              />
              <span>2 hop</span>
            </label>
          </fieldset>

          <label class="switch-inline">
            <input
              type="checkbox"
              checked={graphFilters.threat_only ?? false}
              onChange={(event) =>
                setGraphFilters(
                  'threat_only',
                  event.currentTarget.checked || undefined,
                )
              }
            />
            <span>Threat only</span>
          </label>

          <label class="field graph-limit-field">
            <span>
              {graphFilters.scope === GRAPH_SCOPE_ALL
                ? 'Devices All'
                : `Limit ${graphFilters.limit ?? 200}`}
            </span>
            <input
              type="range"
              min="0"
              max={String(GRAPH_LIMITS.length)}
              step="1"
              value={
                graphFilters.scope === GRAPH_SCOPE_ALL
                  ? String(GRAPH_LIMITS.length)
                  : limitIndex()
              }
              onInput={(event) => {
                const index = Number(event.currentTarget.value);
                if (index >= GRAPH_LIMITS.length) {
                  setGraphFilters('limit', undefined);
                  setGraphFilters('scope', GRAPH_SCOPE_ALL);
                } else {
                  setGraphFilters('scope', undefined);
                  setGraphFilters('limit', GRAPH_LIMITS[index] ?? 200);
                }
              }}
            />
          </label>

          <div class="graph-actions">
            <span class="graph-stat" aria-live="polite">
              <strong>{graphMeta.node_count ?? 0}</strong> nodes
              <strong>{graphMeta.edge_count ?? 0}</strong> edges
              {coverageLabel() ? <span>{coverageLabel()}</span> : null}
            </span>

            <div class="graph-popover-anchor">
              <button
                type="button"
                class="btn btn-ghost"
                aria-expanded={openMenu() === 'views'}
                aria-controls="graph-views-menu"
                onClick={() => toggleMenu('views')}
              >
                <Star size={14} aria-hidden="true" />
                <span>Views</span>
                <ChevronDown size={14} aria-hidden="true" />
              </button>
              <Show when={openMenu() === 'views'}>
                <div
                  class="graph-popover graph-popover--end"
                  id="graph-views-menu"
                  role="group"
                  aria-label="Saved views"
                >
                  <For
                    each={savedViews()}
                    fallback={
                      <p class="graph-panel-empty">No saved views yet.</p>
                    }
                  >
                    {(view) => (
                      <span class="graph-saved-view">
                        <button
                          type="button"
                          class="btn btn-ghost btn-saved-view"
                          onClick={() => handleApplyView(view)}
                        >
                          <Star size={14} aria-hidden="true" />
                          <span>{view.name}</span>
                        </button>
                        <button
                          type="button"
                          class="icon-btn icon-btn-danger"
                          aria-label={`Delete saved view ${view.name}`}
                          onClick={() => handleDeleteView(view)}
                        >
                          <Trash2 size={14} aria-hidden="true" />
                        </button>
                      </span>
                    )}
                  </For>

                  <div class="graph-save-view">
                    <label class="field graph-field">
                      <span>View name</span>
                      <input
                        value={viewName()}
                        placeholder="lab 24h threats"
                        onInput={(event) =>
                          setViewName(event.currentTarget.value)
                        }
                        onKeyDown={handleViewNameKeydown}
                      />
                    </label>
                    <button
                      type="button"
                      class="btn btn-save-view"
                      disabled={!viewName().trim()}
                      onClick={handleSaveView}
                    >
                      Save current filters
                    </button>
                  </div>
                </div>
              </Show>
            </div>

            <button
              type="button"
              class="btn btn-ghost"
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
        </div>
      </section>
    </form>
  );
}
