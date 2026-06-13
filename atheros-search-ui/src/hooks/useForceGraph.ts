import * as d3 from 'd3';
import { createEffect, onCleanup, onMount } from 'solid-js';
import type { Accessor } from 'solid-js';
import type { GraphEdge, GraphNode, NodeKind } from '~/api/types';

export interface SimNode extends GraphNode, d3.SimulationNodeDatum {}

export interface SimEdge extends d3.SimulationLinkDatum<SimNode> {
  id: string;
  source: string | SimNode;
  target: string | SimNode;
  kind: GraphEdge['kind'];
  weight?: number;
  label?: string;
}

export interface ForceGraphOptions {
  selectedNodeId?: Accessor<string | null>;
  pinnedNodeIds?: Accessor<Set<string>>;
  visibleKinds?: Accessor<Set<NodeKind>>;
  onNodeClick?: (node: SimNode) => void;
  onNodeHover?: (node: SimNode | null) => void;
}

export function useForceGraph(
  svgRef: () => SVGSVGElement | undefined,
  nodes: () => GraphNode[],
  edges: () => GraphEdge[],
  options: ForceGraphOptions = {},
) {
  let sim: d3.Simulation<SimNode, SimEdge> | null = null;
  let zoomBehavior: d3.ZoomBehavior<SVGSVGElement, unknown> | null = null;
  let nodeById = new Map<string, SimNode>();

  function build() {
    const el = svgRef();
    if (!el) return;

    sim?.stop();
    sim = null;
    d3.select(el).selectAll('*').remove();

    const bounds = el.getBoundingClientRect();
    const width = Math.max(bounds.width || el.clientWidth, 320);
    const height = Math.max(bounds.height || el.clientHeight, 240);
    const simNodes: SimNode[] = nodes().map((node) => ({ ...node }));
    nodeById = new Map(simNodes.map((node) => [node.id, node]));
    const simEdges: SimEdge[] = edges()
      .filter((edge) => nodeById.has(edge.source) && nodeById.has(edge.target))
      .map((edge) => {
        const next: SimEdge = {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          kind: edge.kind,
        };
        if (edge.weight !== undefined) next.weight = edge.weight;
        if (edge.label !== undefined) next.label = edge.label;
        return next;
      });

    const svg = d3.select<SVGSVGElement, unknown>(el);
    const defs = svg.append('defs');
    [
      'association',
      'probe',
      'cluster_member',
      'shadow',
      'alert_ref',
      'rf_proximity',
      'roaming',
      'same_channel',
      'vendor_link',
    ].forEach((kind) => {
      defs
        .append('marker')
        .attr('id', `arrow-${kind}`)
        .attr('viewBox', '0 -4 8 8')
        .attr('refX', 22)
        .attr('refY', 0)
        .attr('markerWidth', 4)
        .attr('markerHeight', 4)
        .attr('orient', 'auto')
        .append('path')
        .attr('d', 'M0,-4L8,0L0,4')
        .attr('fill', edgeColor(kind));
    });

    const container = svg.append('g').attr('class', 'graph-viewport');
    zoomBehavior = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.05, 6])
      .on('zoom', (event) => container.attr('transform', event.transform));
    svg.call(zoomBehavior);

    const link = container
      .append('g')
      .attr('class', 'graph-links')
      .selectAll<SVGLineElement, SimEdge>('line')
      .data(simEdges, (edge) => edge.id)
      .join('line')
      .attr('class', 'graph-link')
      .attr('data-edge-kind', (edge) => edge.kind)
      .attr('data-source-kind', (edge) => endpointKind(edge.source))
      .attr('data-target-kind', (edge) => endpointKind(edge.target))
      .attr('stroke', (edge) => edgeColor(edge.kind))
      .attr('stroke-width', (edge) => Math.max(0.5, (edge.weight ?? 1) * 0.8))
      .attr('stroke-opacity', 0.5)
      .attr('marker-end', (edge) => `url(#arrow-${edge.kind})`);

    const dragBehavior = d3
      .drag<SVGGElement, SimNode>()
      .on('start', (event, node) => {
        if (!event.active) sim?.alphaTarget(0.3).restart();
        node.fx = node.x;
        node.fy = node.y;
      })
      .on('drag', (event, node) => {
        node.fx = event.x;
        node.fy = event.y;
      })
      .on('end', (event, node) => {
        if (!event.active) sim?.alphaTarget(0);
        if (!options.pinnedNodeIds?.().has(node.id)) {
          node.fx = null;
          node.fy = null;
        }
      });

    const node = container
      .append('g')
      .attr('class', 'graph-nodes')
      .selectAll<SVGGElement, SimNode>('g')
      .data(simNodes, (item) => item.id)
      .join('g')
      .attr('class', 'graph-node')
      .attr('data-kind', (item) => item.kind)
      .attr('tabindex', 0)
      .attr('role', 'button')
      .attr('aria-label', (item) => `${nodeKindLabel(item.kind)} ${item.label}`)
      .on('click', (_, item) => options.onNodeClick?.(item))
      .on('mouseenter', (_, item) => options.onNodeHover?.(item))
      .on('mouseleave', () => options.onNodeHover?.(null));

    node.call(dragBehavior);

    node
      .append('circle')
      .attr('class', 'graph-node-ring')
      .attr('r', (item) => nodeRadius(item) + 4)
      .attr('fill', 'none')
      .attr('stroke', (item) => nodeColor(item))
      .attr('stroke-width', 0.5)
      .attr('stroke-opacity', 0.25);

    node
      .append('circle')
      .attr('class', 'graph-node-body')
      .attr('r', nodeRadius)
      .attr('fill', (item) => `${nodeColor(item)}28`)
      .attr('stroke', (item) => nodeColor(item))
      .attr('stroke-width', 1.5);

    node
      .filter((item) => (item.risk_score ?? 0) > 0.5)
      .append('circle')
      .attr('class', 'graph-node-halo')
      .attr('r', (item) => nodeRadius(item) + 8)
      .attr('fill', 'none')
      .attr('stroke', 'var(--color-danger)')
      .attr('stroke-width', 0.75)
      .attr('stroke-dasharray', '3 3')
      .attr('stroke-opacity', 0.65);

    node
      .append('text')
      .attr('x', (item) => nodeRadius(item) + 5)
      .attr('y', 0)
      .attr('dominant-baseline', 'middle')
      .attr('font-family', 'var(--font-mono)')
      .attr('font-size', 9)
      .attr('fill', 'var(--color-text-secondary)')
      .attr('paint-order', 'stroke')
      .attr('stroke', 'var(--color-bg)')
      .attr('stroke-width', 3)
      .attr('stroke-linejoin', 'round')
      .text((item) => truncate(item.label, 22));

    sim = d3
      .forceSimulation<SimNode>(simNodes)
      .force(
        'link',
        d3
          .forceLink<SimNode, SimEdge>(simEdges)
          .id((item) => item.id)
          .distance((edge) => linkDistance(edge.kind))
          .strength(0.4),
      )
      .force('charge', d3.forceManyBody().strength(-280))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collide', d3.forceCollide<SimNode>((item) => nodeRadius(item) + 18))
      .on('tick', () => {
        link
          .attr('x1', (edge) => (edge.source as SimNode).x ?? 0)
          .attr('y1', (edge) => (edge.source as SimNode).y ?? 0)
          .attr('x2', (edge) => (edge.target as SimNode).x ?? 0)
          .attr('y2', (edge) => (edge.target as SimNode).y ?? 0);
        node.attr(
          'transform',
          (item) => `translate(${item.x ?? 0},${item.y ?? 0})`,
        );
      });

    applyVisibility();
    applySelection();
    applyPinned();
  }

  function resetZoom() {
    const el = svgRef();
    if (!el || !zoomBehavior) return;
    d3.select<SVGSVGElement, unknown>(el).call(
      zoomBehavior.transform,
      d3.zoomIdentity,
    );
  }

  function stop() {
    sim?.stop();
    sim = null;
  }

  function applyVisibility() {
    const el = svgRef();
    if (!el) return;
    const visible = options.visibleKinds?.();
    if (!visible) return;

    d3.select(el)
      .selectAll<SVGGElement, SimNode>('.graph-node')
      .style('display', (item) => (visible.has(item.kind) ? null : 'none'));

    d3.select(el)
      .selectAll<SVGLineElement, SimEdge>('.graph-link')
      .style('display', (edge) =>
        visible.has(endpointKind(edge.source)) &&
        visible.has(endpointKind(edge.target))
          ? null
          : 'none',
      );
  }

  function applySelection() {
    const el = svgRef();
    if (!el) return;
    const selected = options.selectedNodeId?.() ?? null;
    d3.select(el)
      .selectAll<SVGGElement, SimNode>('.graph-node')
      .classed('selected', (item) => item.id === selected);
  }

  function applyPinned() {
    const el = svgRef();
    if (!el) return;
    const pinned = options.pinnedNodeIds?.() ?? new Set<string>();
    d3.select(el)
      .selectAll<SVGGElement, SimNode>('.graph-node')
      .classed('pinned', (item) => pinned.has(item.id));
  }

  function endpointKind(value: string | SimNode): NodeKind {
    if (typeof value === 'string') {
      return nodeById.get(value)?.kind ?? 'device';
    }
    return value.kind;
  }

  onMount(build);
  createEffect(() => {
    options.visibleKinds?.();
    applyVisibility();
  });
  createEffect(() => {
    options.selectedNodeId?.();
    applySelection();
  });
  createEffect(() => {
    options.pinnedNodeIds?.();
    applyPinned();
  });
  onCleanup(stop);

  return { rebuild: build, resetZoom, stop };
}

export function nodeRadius(node: GraphNode): number {
  if (node.kind === 'cluster') {
    return 10 + Math.min((node.cluster_size ?? 1) * 1.5, 12);
  }
  if (node.kind === 'ap') return 10;
  if (node.kind === 'shadow_alert' || node.kind === 'alert') return 8;
  return 7;
}

export function nodeColor(node: Pick<GraphNode, 'kind'>): string {
  switch (node.kind) {
    case 'device':
      return 'var(--color-accent)';
    case 'cluster':
      return 'var(--score-dense)';
    case 'ap':
      return 'var(--color-info)';
    case 'client':
      return 'var(--color-ok)';
    case 'shadow_alert':
      return 'var(--color-danger)';
    case 'alert':
      return 'var(--color-warn)';
    case 'embedding':
      return 'var(--score-dense)';
    default:
      return 'var(--color-text-tertiary)';
  }
}

export function nodeKindLabel(kind: NodeKind): string {
  switch (kind) {
    case 'shadow_alert':
      return 'Shadow alert';
    case 'ap':
      return 'Access point';
    default:
      return kind.replaceAll('_', ' ');
  }
}

function edgeColor(kind: string): string {
  switch (kind) {
    case 'association':
      return 'var(--color-accent)';
    case 'probe':
      return 'var(--color-ok)';
    case 'cluster_member':
      return 'var(--score-dense)';
    case 'shadow':
      return 'var(--color-danger)';
    case 'alert_ref':
      return 'var(--color-warn)';
    case 'rf_proximity':
      return 'var(--color-info)';
    case 'roaming':
      return 'var(--color-border-focus)';
    default:
      return 'var(--color-border)';
  }
}

function linkDistance(kind: string): number {
  switch (kind) {
    case 'cluster_member':
      return 60;
    case 'association':
      return 90;
    case 'probe':
      return 110;
    case 'shadow':
    case 'alert_ref':
      return 130;
    default:
      return 150;
  }
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}
