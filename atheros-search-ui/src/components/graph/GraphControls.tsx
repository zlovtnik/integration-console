import { For } from 'solid-js';
import { LocateFixed, RefreshCw } from 'lucide-solid';
import {
  GRAPH_LIMITS,
  GRAPH_NODE_KINDS,
  graphFilters,
  graphLoading,
  graphMeta,
  setGraphFilters,
  setGraphKindVisibility,
  visibleGraphKinds,
} from '~/stores/graphStore';
import { suggestions } from '~/stores/suggestStore';
import { nodeKindLabel } from '~/hooks/useForceGraph';
import type { NodeKind } from '~/api/types';
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
  function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    props.onRefresh();
  }

  function handleKind(kind: NodeKind, checked: boolean) {
    setGraphKindVisibility(kind, checked);
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

      <div class="graph-actions">
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
