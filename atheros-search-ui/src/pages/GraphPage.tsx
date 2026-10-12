import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { AlertTriangle } from 'lucide-solid';
import { useSearchParams } from '@solidjs/router';
import { GraphControls } from '~/components/graph/GraphControls';
import { GraphNavigation, type GraphNavigationApi } from '~/components/graph/GraphNavigation';
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
import { useHierarchyLayout } from '~/hooks/useHierarchyLayout';
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
  graphLayoutMode,
  graphMeta,
  graphNodes,
  pinnedNodeIds,
  selectedNodeId,
  setGraphFilters,
  setGraphLayoutMode,
  setSelectedNodeId,
  visibleGraphEdgeKinds,
  visibleGraphKinds,
  showSecondaryGraphEdges,
} from '~/stores/graphStore';
import '~/styles/graph.css';

export default function GraphPage() {
  const [params] = useSearchParams();
  onMount(() => {
    document.title = 'Network map - atheros search';
  });
  return (
    <main id="main-content" class="graph-page network-graph-page" tabIndex={-1}>
      <ProjectionGraph />
      <details class="report-controls">
        <summary>Wireless observation evidence</summary>
        <WirelessTopology />
      </details>
      <details class="report-controls" open={Boolean(params.ap || params.node)}>
        <summary>Access point report</summary>
        <NetworkReport />
      </details>
    </main>
  );
}

function ProjectionGraph() {
  const [urlParams, setUrlParams] = useSearchParams();
  const [urlReady, setUrlReady] = createSignal(false);
  let filterReloadTimer: number | undefined;
  const [navigation, setNavigation] = createSignal<GraphNavigationApi | null>(null);
  const resetView = () => navigation()?.resetZoom();
  const [hiddenRelationships, setHiddenRelationships] = createSignal(0);
  const [layoutIssues, setLayoutIssues] = createSignal<string[]>([]);
  const { load } = useGraph();
  const [expandedAPIds, setExpandedAPIds] = createSignal<Set<string>>(
    new Set(),
  );

  useSuggest();

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
      hierarchy: graphFilters.hierarchy ?? false,
      root_bssid: graphFilters.root_bssid ?? '',
      root_node_id: graphFilters.root_node_id ?? '',
    }),
  );

  onMount(() => {
    document.title = 'Wireless observations - atheros search';
    const sourceMac =
      new URLSearchParams(window.location.search).get('g_mac') ??
      new URLSearchParams(window.location.search).get('mac');
    const anchor = sourceMac?.trim();
    const storedHops = Number(urlParams.g_hops);
    const storedLimit = Number(urlParams.g_limit);
    const mode = urlParams.g_layout === 'overview' || urlParams.g_layout === 'hierarchy'
      ? urlParams.g_layout : 'groups';
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
      setGraphLayoutMode(mode);
      setGraphFilters('hierarchy', mode === 'hierarchy');
      setGraphFilters('root_bssid', typeof urlParams.g_root === 'string' ? urlParams.g_root : undefined);
      setGraphFilters('source_mac', anchor || undefined);
      setGraphFilters(
        'hops',
        Number.isInteger(storedHops) && storedHops > 0 ? storedHops : 1,
      );
      setGraphFilters(
        'limit',
        Number.isInteger(storedLimit) && storedLimit > 0 ? storedLimit : undefined,
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
        resetView();
      } else if (target?.classList.contains('graph-canvas')) {
        const pan: Record<string, [number, number]> = {
          ArrowLeft: [80, 0], ArrowRight: [-80, 0], ArrowUp: [0, 80], ArrowDown: [0, -80],
        };
        const direction = pan[event.key];
        if (direction) {
          event.preventDefault();
          navigation()?.panBy(...direction);
        } else if (event.key === '+' || event.key === '=' || event.key === '-') {
          event.preventDefault();
          navigation()?.zoomBy(event.key === '-' ? 1 / 1.25 : 1.25);
        }
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
          g_limit: graphFilters.limit ? String(graphFilters.limit) : undefined,
          g_layout: graphLayoutMode(),
          g_root: graphFilters.root_bssid,
          g_threat: graphFilters.threat_only ? '1' : undefined,
          g_scope: graphFilters.scope === 'all' ? 'all' : undefined,
          g_edges: graphFilters.edge_kinds?.join(',') || undefined,
          g_kinds: graphFilters.kinds?.join(',') || undefined,
        },
        { replace: true },
      );
    }),
  );

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

  return (
    <section class="graph-workspace" aria-label="Wireless observation graph">
      <header class="graph-workspace-header">
        <div>
          <h1>Wireless observations</h1>
          <p>Observations do not confirm connections or ownership.</p>
        </div>
        <button type="button" class="btn btn-secondary" disabled={graphLoading()} onClick={() => void load()}>Refresh graph</button>
      </header>
      <details class="graph-filter-drawer">
        <summary>Filters and layout</summary>
        <GraphControls onRefresh={() => void load()} />
      </details>

      <div class="graph-coverage-notices" aria-live="polite">
        <Show when={graphMeta.hierarchy?.truncated}>
          <span class="graph-coverage-warning" role="status">
            Partial graph: {graphMeta.hierarchy?.reason || graphMeta.focus_reason || 'the returned neighborhood is incomplete'}.
          </span>
        </Show>
        <Show when={graphMeta.report?.incomplete_coverage}>
          <span class="graph-coverage-warning" role="status">
            Observation coverage is unverified. This graph uses wireless
            observations; proxy search results do not populate it.
          </span>
        </Show>
        <Show when={hiddenRelationships() > 0}>
          <span class="graph-coverage-warning" role="status">{hiddenRelationships()} relationships hidden</span>
        </Show>
        <Show when={layoutIssues().length > 0}>
          <span class="graph-coverage-warning" role="status" title={layoutIssues().join('; ')}>
            {layoutIssues().length} topology issues; affected nodes are shown as unattached.
          </span>
        </Show>
      </div>

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
        <Show when={!graphLoading() && !graphError() && graphNodes().length === 0}>
          <p class="graph-coverage-warning" role="status">
            No wireless graph records are available in this scope. Check the
            location and time filters, then sensor capture and ingestion.
          </p>
        </Show>
        <Show when={graphLayoutMode() === 'hierarchy'} fallback={
          <ForceCanvas
            expandedAPIds={expandedAPIds()}
            onExpand={(id) => setExpandedAPIds((prev) => new Set([...prev, id]))}
            onReady={(api) => { setNavigation(api); setLayoutIssues([]); }}
            onHidden={setHiddenRelationships}
          />
        }>
          <HierarchyCanvas
            onReady={setNavigation}
            onHidden={setHiddenRelationships}
            onIssues={setLayoutIssues}
          />
        </Show>
      </div>
      <footer class="graph-workspace-footer">
        <div class="graph-workspace-status">
          <span><strong>{graphNodes().length}</strong> nodes / <strong>{graphEdges().length}</strong> relationships</span>
          <span id="graph-navigation-hint">Drag to pan. Scroll or +/- to zoom. Arrow keys to pan. Spacing is not physical distance.</span>
        </div>
        <GraphNavigation graph={navigation()} />
        <details class="graph-key"><summary>Color key</summary><GraphLegend /></details>
      </footer>

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

function HierarchyCanvas(props: {
  onReady: (api: GraphNavigationApi) => void;
  onHidden: (count: number) => void;
  onIssues: (issues: string[]) => void;
}) {
  let svgRef: SVGSVGElement | undefined;
  const graph = useHierarchyLayout(() => svgRef, graphNodes, graphEdges, {
    hierarchy: () => graphMeta.hierarchy,
    selectedNodeId, pinnedNodeIds,
    visibleKinds: visibleGraphKinds, visibleEdgeKinds: visibleGraphEdgeKinds,
    showSecondary: showSecondaryGraphEdges,
    onClearSelection: () => setSelectedNodeId(null),
    onNodeClick: (node) => setSelectedNodeId((current) => current === node.id ? null : node.id),
  });
  onMount(() => props.onReady(graph));
  createEffect(on(graph.hiddenRelationshipCount, (count) => props.onHidden(count)));
  createEffect(on(graph.issues, (issues) => props.onIssues(issues)));
  return <svg ref={svgRef} class="graph-canvas" tabIndex={0} aria-describedby="graph-navigation-hint" aria-label="Device network graph" />;
}

function ForceCanvas(props: {
  expandedAPIds: Set<string>;
  onExpand: (id: string) => void;
  onReady: (api: GraphNavigationApi) => void;
  onHidden: (count: number) => void;
}) {
  let svgRef: SVGSVGElement | undefined;
  const renderModel = createMemo(() => buildGraphRenderModel(
    graphNodes(), graphEdges(), props.expandedAPIds,
    graphLayoutMode() === 'groups' ? GRAPH_AGGREGATE_THRESHOLD : Number.POSITIVE_INFINITY,
  ));
  const graph = useForceGraph(() => svgRef, () => renderModel().nodes, () => renderModel().edges, {
    selectedNodeId, pinnedNodeIds,
    visibleKinds: visibleGraphKinds, visibleEdgeKinds: visibleGraphEdgeKinds,
    layoutMode: () => graphLayoutMode() === 'groups' ? 'groups' : 'overview',
    hiddenRelationshipCount: () => renderModel().hiddenRelationshipCount,
    onClearSelection: () => setSelectedNodeId(null),
    onNodeClick: (node) => {
      if (node.id.startsWith('aggregate:')) props.onExpand(node.id.replace('aggregate:', ''));
      else setSelectedNodeId((current) => current === node.id ? null : node.id);
    },
  });
  onMount(() => props.onReady(graph));
  createEffect(on(renderModel, graph.rebuild, { defer: true }));
  createEffect(on(graph.hiddenRelationshipCount, (count) => props.onHidden(count)));
  return <svg ref={svgRef} class="graph-canvas" tabIndex={0} aria-describedby="graph-navigation-hint" data-layout={graphLayoutMode()} aria-label="Device network graph" />;
}
