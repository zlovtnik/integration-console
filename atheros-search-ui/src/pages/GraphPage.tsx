import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  Show,
  startTransition,
} from 'solid-js';
import { AlertTriangle } from 'lucide-solid';
import { useSearchParams } from '@solidjs/router';
import { GraphControls } from '~/components/graph/GraphControls';
import { WirelessTopology } from '~/components/graph/WirelessTopology';
import { NetworkReport } from '~/components/graph/NetworkReport';
import { GraphLegend } from '~/components/graph/GraphLegend';
import { GraphNodePanel } from '~/components/graph/GraphNodePanel';
import {
  GRAPH_EDGE_KINDS,
  GRAPH_NODE_KINDS,
  setVisibleGraphEdgeKinds,
  setVisibleGraphKinds,
} from '~/stores/graphStore';
import type { EdgeKind, NodeKind } from '~/api/types';
import { useForceGraph } from '~/hooks/useForceGraph';
import {
  buildGraphRenderModel,
  GRAPH_AGGREGATE_THRESHOLD,
} from '~/hooks/useGraphAggregate';
import { useGraph } from '~/hooks/useGraph';
import { useSuggest } from '~/hooks/useSuggest';
import {
  graphEdges,
  graphError,
  graphFilters,
  graphLoading,
  graphNodes,
  pinnedNodeIds,
  selectedNodeId,
  setGraphFilters,
  setSelectedNodeId,
  visibleGraphEdgeKinds,
  visibleGraphKinds,
} from '~/stores/graphStore';
import '~/styles/graph.css';

export default function GraphPage() {
  const [explore, setExplore] = createSignal(false);
  onMount(() => {
    document.title = 'Network map - atheros search';
  });
  return (
    <main id="main-content" class="graph-page" tabIndex={-1}>
      <WirelessTopology />
      <NetworkReport />
      <details class="report-controls">
        <summary>Advanced projection explorer</summary>
        <p>
          Technical node/edge controls and hop count apply to the latest bounded
          projection. Historical absence cannot be inferred here. Node positions
          do not represent physical distance.
        </p>
        <button
          type="button"
          class="btn btn-secondary"
          onClick={() => {
            setGraphFilters('scope', undefined);
            setGraphFilters('limit', 200);
            setExplore((value) => !value);
          }}
        >
          {explore() ? 'Close projection explorer' : 'Open projection explorer'}
        </button>
        <Show when={explore()}>
          <ProjectionGraph />
        </Show>
      </details>
    </main>
  );
}

function ProjectionGraph() {
  const [urlParams, setUrlParams] = useSearchParams();
  const [urlReady, setUrlReady] = createSignal(false);
  let svgRef: SVGSVGElement | undefined;
  let filterReloadTimer: number | undefined;
  let rebuildQueued = false;
  const { load } = useGraph();
  const [expandedAPIds, setExpandedAPIds] = createSignal<Set<string>>(
    new Set(),
  );

  useSuggest();

  const renderModel = createMemo(() =>
    buildGraphRenderModel(
      graphNodes(),
      graphEdges(),
      expandedAPIds(),
      GRAPH_AGGREGATE_THRESHOLD,
    ),
  );

  const graph = useForceGraph(
    () => svgRef,
    () => renderModel().nodes,
    () => renderModel().edges,
    {
      selectedNodeId,
      onClearSelection: () => setSelectedNodeId(null),
      pinnedNodeIds,
      visibleKinds: visibleGraphKinds,
      visibleEdgeKinds: visibleGraphEdgeKinds,
      onNodeClick: (node) => {
        if (node.id.startsWith('aggregate:')) {
          const apID = node.id.replace('aggregate:', '');
          setExpandedAPIds((prev) => new Set([...prev, apID]));
          return;
        }
        setSelectedNodeId((current) => (current === node.id ? null : node.id));
      },
    },
  );

  const selected = createMemo(
    () => graphNodes().find((node) => node.id === selectedNodeId()) ?? null,
  );
  const filterKey = createMemo(() =>
    JSON.stringify({
      location_ids: graphFilters.location_ids ?? [],
      sensor_ids: graphFilters.sensor_ids ?? [],
      source_mac: graphFilters.source_mac ?? '',
      ssid: graphFilters.ssid ?? '',
      kinds: graphFilters.kinds ?? [],
      edge_kinds: graphFilters.edge_kinds ?? [],
      threat_only: graphFilters.threat_only ?? false,
      observed_after: graphFilters.observed_after ?? '',
      observed_before: graphFilters.observed_before ?? '',
      hops: graphFilters.hops ?? 1,
      scope: graphFilters.scope ?? '',
      limit: graphFilters.limit ?? 0,
    }),
  );

  onMount(() => {
    document.title = 'Network map projection explorer - atheros search';
    const sourceMac =
      new URLSearchParams(window.location.search).get('g_mac') ??
      new URLSearchParams(window.location.search).get('mac');
    const anchor = sourceMac?.trim();
    const storedHops = Number(urlParams.g_hops);
    const storedLimit = Number(urlParams.g_limit);
    const edgeKinds =
      typeof urlParams.g_edges === 'string'
        ? urlParams.g_edges
            .split(',')
            .filter((kind): kind is EdgeKind =>
              GRAPH_EDGE_KINDS.includes(kind as EdgeKind),
            )
        : [];
    const nodeKinds =
      typeof urlParams.g_kinds === 'string'
        ? urlParams.g_kinds
            .split(',')
            .filter((kind): kind is NodeKind =>
              GRAPH_NODE_KINDS.includes(kind as NodeKind),
            )
        : [];
    batch(() => {
      setGraphFilters('source_mac', anchor || undefined);
      setGraphFilters(
        'hops',
        Number.isInteger(storedHops) && storedHops > 0 ? storedHops : 1,
      );
      setGraphFilters(
        'limit',
        Number.isInteger(storedLimit) && storedLimit > 0 ? storedLimit : 200,
      );
      setGraphFilters(
        'ssid',
        typeof urlParams.ssid === 'string' ? urlParams.ssid : undefined,
      );
      setGraphFilters('threat_only', urlParams.g_threat === '1');
      setGraphFilters('scope', urlParams.g_scope === 'all' ? 'all' : undefined);
      setGraphFilters(
        'edge_kinds',
        edgeKinds.length ? edgeKinds : ['association'],
      );
      setVisibleGraphEdgeKinds(
        new Set(edgeKinds.length ? edgeKinds : ['association']),
      );
      setGraphFilters('kinds', nodeKinds.length ? nodeKinds : undefined);
      setVisibleGraphKinds(
        new Set(nodeKinds.length ? nodeKinds : GRAPH_NODE_KINDS),
      );
    });
    setUrlReady(true);
    if (anchor) {
      setGraphFilters('source_mac', anchor);
    } else {
      void load();
    }

    function handleKeydown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return;
      }

      if (event.key === 'Escape') {
        setSelectedNodeId(null);
      } else if (event.key.toLowerCase() === 'r') {
        graph.resetZoom();
      }
    }

    window.addEventListener('keydown', handleKeydown);
    onCleanup(() => window.removeEventListener('keydown', handleKeydown));
  });

  createEffect(
    on(filterKey, () => {
      if (!urlReady()) return;
      setUrlParams(
        {
          loc: graphFilters.location_ids,
          sensor: graphFilters.sensor_ids,
          after: graphFilters.observed_after,
          before: graphFilters.observed_before,
          ssid: graphFilters.ssid,
          g_mac: graphFilters.source_mac,
          g_hops: String(graphFilters.hops ?? 1),
          g_limit: String(graphFilters.limit ?? 200),
          g_threat: graphFilters.threat_only ? '1' : undefined,
          g_scope: graphFilters.scope === 'all' ? 'all' : undefined,
          g_edges: graphFilters.edge_kinds?.join(',') || undefined,
          g_kinds: graphFilters.kinds?.join(',') || undefined,
        },
        { replace: true },
      );
    }),
  );

  createEffect(on(renderModel, queueGraphRebuild));

  createEffect(
    on(
      filterKey,
      () => {
        window.clearTimeout(filterReloadTimer);
        filterReloadTimer = window.setTimeout(() => {
          void load();
        }, 250);
      },
      { defer: true },
    ),
  );

  onCleanup(() => window.clearTimeout(filterReloadTimer));

  function queueGraphRebuild() {
    if (rebuildQueued) return;
    rebuildQueued = true;

    queueMicrotask(() => {
      rebuildQueued = false;
      void startTransition(() => {
        batch(() => graph.rebuild());
      });
    });
  }

  return (
    <section class="graph-page" aria-label="Advanced graph projection">
      <GraphControls
        onRefresh={() => void load()}
        onResetView={() => graph.resetZoom()}
      />

      <div class="graph-canvas-wrap">
        <Show when={graphLoading()}>
          <div class="graph-loading" role="status">
            Building graph...
          </div>
        </Show>
        <Show when={graphError()}>
          <div class="graph-error" role="alert">
            <AlertTriangle size={16} aria-hidden="true" />
            <span>{graphError()}</span>
            <button
              type="button"
              class="btn btn-secondary"
              onClick={() => void load()}
            >
              Retry
            </button>
          </div>
        </Show>
        <svg
          ref={svgRef}
          class="graph-canvas"
          aria-label="Device network graph"
        />
        <GraphLegend />
      </div>

      <Show when={selected()}>
        {(node) => (
          <GraphNodePanel
            node={node()}
            onClose={() => setSelectedNodeId(null)}
          />
        )}
      </Show>
    </section>
  );
}
