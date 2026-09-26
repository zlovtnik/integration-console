import * as d3 from 'd3';
import { createEffect, on, onMount } from 'solid-js';
import type { Accessor } from 'solid-js';
import type { EdgeKind, GraphEdge, GraphNode, NodeKind } from '~/api/types';
import {
  createSimNodes,
  finiteCoord,
  stableUnitValue,
  useForceLayout,
  type SimNodeDatum,
} from './useForceLayout';
import { useGraphPresentation } from './graphPresentation';

export type SimNode = SimNodeDatum<GraphNode>;

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
  onClearSelection?: () => void;
  pinnedNodeIds?: Accessor<Set<string>>;
  visibleKinds?: Accessor<Set<NodeKind>>;
  visibleEdgeKinds?: Accessor<Set<EdgeKind>>;
  onNodeClick?: (node: SimNode) => void;
  onNodeHover?: (node: SimNode | null) => void;
}

export function useForceGraph(
  svgRef: () => SVGSVGElement | undefined,
  nodes: () => GraphNode[],
  edges: () => GraphEdge[],
  options: ForceGraphOptions = {},
) {
  const layout = useForceLayout<GraphNode, SimEdge>(svgRef, {
    pinnedNodeIds: options.pinnedNodeIds,
  });
  const presentation = useGraphPresentation<SimNode>(
    svgRef,
    () => options.selectedNodeId?.() ?? null,
    () => options.onClearSelection?.(),
  );
  let visibilityEffectReady = false;

  function build() {
    presentation.reset();
    const prepared = layout.prepare(nodes());
    if (!prepared) return;
    const { svg, container, width, height, simNodes, nodeById } = prepared;
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

    const defs = presentation.prepare(svg);
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
        .attr('id', `${presentation.prefix}-arrow-${kind}`)
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
      .attr('stroke-width', (edge) => Math.max(0.5, edge.weight ?? 1))
      .attr('stroke-opacity', (edge) => edgeOpacity(edge.kind))
      .attr('stroke-dasharray', (edge) => edgeDash(edge.kind))
      .style('--edge-opacity', (edge) => edgeOpacity(edge.kind))
      .attr(
        'marker-end',
        (edge) => `url(#${presentation.prefix}-arrow-${edge.kind})`,
      );

    link
      .append('title')
      .text((edge) => edge.label || edge.kind.replaceAll('_', ' '));

    const dragBehavior = layout.createDragBehavior();

    const node = container
      .append('g')
      .attr('class', 'graph-nodes')
      .selectAll<SVGGElement, SimNode>('g')
      .data(simNodes, (item) => item.id)
      .join('g')
      .attr('class', 'graph-node')
      .attr('data-kind', (item) => item.kind)
      .attr('data-node-id', (item) => item.id)
      .attr('data-label', (item) => item.label)
      .attr('tabindex', 0)
      .attr('role', 'button')
      .attr('aria-label', (item) => `${nodeKindLabel(item.kind)} ${item.label}`)
      .on('click', (_, item) => options.onNodeClick?.(item))
      .on('keydown', (event, item) => {
        if (
          event.key !== 'Enter' &&
          event.key !== ' ' &&
          event.code !== 'Space'
        ) {
          return;
        }
        event.preventDefault();
        options.onNodeClick?.(item);
      });

    node.call(dragBehavior);

    presentation.decorate(node, {
      radius: nodeRadius,
      color: nodeColor,
      count: (item) =>
        item.kind === 'aggregate_group'
          ? item.occurrence_count
          : item.kind === 'cluster'
            ? item.cluster_size
            : undefined,
      alwaysLabel: (item) =>
        item.kind === 'ap' || item.kind === 'aggregate_group',
      onHover: options.onNodeHover,
    });

    node
      .filter((item) => hasSeverityHalo(item))
      .append('circle')
      .attr('class', 'graph-node-halo')
      .attr('r', (item) => nodeRadius(item) + 8)
      .attr('fill', 'none')
      .attr('stroke', (item) => severityHaloColor(item))
      .attr('stroke-width', 0.75)
      .attr('stroke-dasharray', (item) =>
        (item.risk_score ?? 0) > 0.5 ? '3 3' : 'none',
      )
      .attr('stroke-opacity', 0.65);

    let fitOnSimulationEnd = true;
    const simulation = d3
      .forceSimulation<SimNode>(simNodes)
      .force(
        'link',
        d3
          .forceLink<SimNode, SimEdge>(simEdges)
          .id((item) => item.id)
          .distance((edge) => linkDistance(edge.kind))
          .strength(0.4),
      )
      .force('charge', d3.forceManyBody().strength(-210))
      .force(
        'x',
        d3.forceX<SimNode>((item) => nodeLaneX(item, width)).strength(0.16),
      )
      .force(
        'y',
        d3
          .forceY<SimNode>((item, index) => nodeLaneY(item, index, height))
          .strength(0.08),
      )
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force(
        'collide',
        d3.forceCollide<SimNode>((item) => nodeRadius(item) + 14),
      )
      .on('tick', () => {
        link
          .attr('x1', (edge) => finiteCoord((edge.source as SimNode).x))
          .attr('y1', (edge) => finiteCoord((edge.source as SimNode).y))
          .attr('x2', (edge) => finiteCoord((edge.target as SimNode).x))
          .attr('y2', (edge) => finiteCoord((edge.target as SimNode).y));
        node.attr(
          'transform',
          (item) => `translate(${finiteCoord(item.x)},${finiteCoord(item.y)})`,
        );
      })
      .on('end', () => {
        if (!fitOnSimulationEnd) return;
        fitOnSimulationEnd = false;
        layout.fitToGraph();
      });

    layout.setSimulation(simulation);

    applyVisibility(false);
    applySelection();
    applyPinned();
    layout.markBuilt();
  }

  function applyVisibility(
    restartSimulation: boolean,
    visible = options.visibleKinds?.(),
    visibleEdgeKinds = options.visibleEdgeKinds?.(),
  ) {
    const el = svgRef();
    if (!el) return;
    if (!visible) return;
    const visibleKinds = visible;

    d3.select(el)
      .selectAll<SVGGElement, SimNode>('.graph-node')
      .style('display', (item) => (kindIsVisible(item.kind) ? null : 'none'));

    function kindIsVisible(kind: NodeKind): boolean {
      return kind === 'aggregate_group' || visibleKinds.has(kind);
    }

    function edgeIsVisible(edge: SimEdge): boolean {
      return (
        kindIsVisible(endpointKind(edge.source)) &&
        kindIsVisible(endpointKind(edge.target)) &&
        (!visibleEdgeKinds || visibleEdgeKinds.has(edge.kind))
      );
    }

    d3.select(el)
      .selectAll<SVGLineElement, SimEdge>('.graph-link')
      .style('display', (edge) => (edgeIsVisible(edge) ? null : 'none'))
      .attr('marker-end', (edge) =>
        edgeIsVisible(edge)
          ? `url(#${presentation.prefix}-arrow-${edge.kind})`
          : null,
      );

    presentation.paint();
    if (restartSimulation) layout.restart();
  }

  function applySelection(selected = options.selectedNodeId?.() ?? null) {
    const related = presentation.paint();
    if (selected && related.size)
      queueMicrotask(() => layout.fitToGraph(related, 80));
  }

  function applyPinned(
    pinned = options.pinnedNodeIds?.() ?? new Set<string>(),
  ) {
    const el = svgRef();
    if (!el) return;
    d3.select(el)
      .selectAll<SVGGElement, SimNode>('.graph-node')
      .classed('pinned', (item) => pinned.has(item.id))
      .each((item) => {
        if (pinned.has(item.id)) {
          if (item.fx == null || item.fy == null) {
            item.fx = item.x ?? null;
            item.fy = item.y ?? null;
          }
          return;
        }

        item.fx = null;
        item.fy = null;
      });
  }

  function endpointKind(value: string | SimNode): NodeKind {
    if (typeof value === 'string') {
      return layout.nodeById().get(value)?.kind ?? 'device';
    }
    return value.kind;
  }

  onMount(build);
  createEffect(
    on(
      () => [options.visibleKinds?.(), options.visibleEdgeKinds?.()] as const,
      ([visible, visibleEdgeKinds]) => {
        applyVisibility(visibilityEffectReady, visible, visibleEdgeKinds);
        visibilityEffectReady = true;
      },
    ),
  );
  createEffect(on(() => options.selectedNodeId?.() ?? null, applySelection));
  createEffect(on(() => options.pinnedNodeIds?.(), applyPinned));

  return { rebuild: build, resetZoom: layout.resetZoom, stop: layout.stop };
}

export { createSimNodes };

function nodeLaneX(node: GraphNode, width: number): number {
  const lanes: Record<NodeKind, number> = {
    cluster: 0.3,
    device: 0.34,
    client: 0.52,
    ap: 0.72,
    shadow_alert: 0.88,
    alert: 0.88,
    embedding: 0.5,
    aggregate_group: 0.62,
  };
  return width * (lanes[node.kind] ?? 0.5);
}

function nodeLaneY(node: GraphNode, index: number, height: number): number {
  const band = Math.max(160, height * 0.78);
  const top = Math.max(32, (height - band) / 2);
  const spread = stableUnitValue(node.id || `${node.kind}:${index}`);
  return top + spread * band;
}

export function nodeRadius(node: GraphNode): number {
  if (node.kind === 'cluster') {
    return 14 + Math.min(Math.max(0, (node.cluster_size ?? 1) - 1) * 1.5, 12);
  }
  if (node.kind === 'aggregate_group') {
    return 13 + Math.min((node.occurrence_count ?? 1) * 0.4, 10);
  }
  if (node.kind === 'ap') return 18;
  if (node.kind === 'client') return 7;
  if (node.kind === 'shadow_alert' || node.kind === 'alert') return 10;
  return 9;
}

export function nodeColor(node: Pick<GraphNode, 'kind'>): string {
  switch (node.kind) {
    case 'device':
      return 'var(--graph-device)';
    case 'cluster':
      return 'var(--graph-cluster)';
    case 'ap':
      return 'var(--graph-info)';
    case 'client':
      return 'var(--graph-ok)';
    case 'shadow_alert':
      return 'var(--graph-danger)';
    case 'alert':
      return 'var(--graph-warn)';
    case 'embedding':
      return 'var(--graph-cluster)';
    case 'aggregate_group':
      return 'var(--color-text-tertiary)';
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
    case 'aggregate_group':
      return 'Visual group';
    default:
      return kind.replaceAll('_', ' ');
  }
}

function highSeverity(item: SimNode): boolean {
  return item.alert_severity === 'high' || item.alert_severity === 'critical';
}

function hasSeverityHalo(item: SimNode): boolean {
  return (item.risk_score ?? 0) > 0.5 || highSeverity(item);
}

function severityHaloColor(item: SimNode): string {
  if ((item.risk_score ?? 0) > 0.5) return 'var(--graph-danger)';
  return 'var(--graph-warn)';
}

export function edgeKindLabel(kind: EdgeKind): string {
  switch (kind) {
    case 'association':
      return 'Device-AP association';
    case 'cluster_member':
      return 'Identity cluster member';
    case 'rf_proximity':
      return 'RF proximity';
    case 'same_channel':
      return 'Same channel';
    case 'vendor_link':
      return 'Shared vendor OUI';
    case 'alert_ref':
      return 'Alert reference';
    default:
      return kind.replaceAll('_', ' ');
  }
}

export function edgeColor(kind: string): string {
  switch (kind) {
    case 'association':
      return 'var(--graph-accent)';
    case 'probe':
      return 'var(--graph-ok)';
    case 'cluster_member':
      return 'var(--graph-cluster)';
    case 'shadow':
      return 'var(--graph-danger)';
    case 'alert_ref':
      return 'var(--graph-warn)';
    case 'rf_proximity':
      return 'var(--graph-info)';
    case 'roaming':
      return 'var(--graph-accent)';
    case 'same_channel':
      return 'var(--graph-info)';
    case 'vendor_link':
      return 'var(--graph-ok)';
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

export function edgeDash(kind: string): string | null {
  if (kind === 'roaming' || kind === 'probe') return '6 3';
  if (['same_channel', 'vendor_link', 'rf_proximity'].includes(kind))
    return '2 5';
  return null;
}

export function edgeOpacity(kind: string): number {
  const values: Record<string, number> = {
    association: 0.65,
    cluster_member: 0.55,
    roaming: 0.45,
    same_channel: 0.22,
    vendor_link: 0.22,
    rf_proximity: 0.22,
    probe: 0.4,
    shadow: 0.72,
    alert_ref: 0.62,
  };
  return values[kind] ?? 0.3;
}
