import * as d3 from 'd3';
import { onCleanup } from 'solid-js';
import type { Accessor } from 'solid-js';

export interface ForceLayoutNode {
  id: string;
}

export type SimNodeDatum<T extends ForceLayoutNode> = T &
  d3.SimulationNodeDatum;

export interface ForceLayoutBuild<T extends ForceLayoutNode> {
  svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  container: d3.Selection<SVGGElement, unknown, null, undefined>;
  width: number;
  height: number;
  simNodes: SimNodeDatum<T>[];
  nodeById: Map<string, SimNodeDatum<T>>;
}

export interface ForceLayoutOptions {
  pinnedNodeIds?: Accessor<Set<string>> | undefined;
  maxFitScale?: number;
}

export interface GraphScale {
  charge: number;
  linkDistance: (base: number) => number;
  collidePad: number;
  siblingGap: number;
  depthGap: number;
  fitPadding: number;
  zoomScaleExtent: [number, number];
}

export function scaleFor(n: number, width: number, height: number): GraphScale {
  const count = Math.max(1, Number.isFinite(n) ? n : 1);
  const viewportWidth = Math.max(320, Number.isFinite(width) ? width : 320);
  const viewportHeight = Math.max(240, Number.isFinite(height) ? height : 240);
  const viewportScale = clamp(Math.hypot(viewportWidth, viewportHeight) / 1200, 0.7, 1.8);
  // Keep short links readable in small graphs; larger graphs need more room.
  const densityScale = clamp(Math.cbrt(count / 50), 0.85, 2.2);
  return {
    charge: -(60 + 12 * Math.sqrt(count)),
    linkDistance: (base) => base * densityScale * viewportScale,
    collidePad: 10 + 4 * Math.sqrt(count / 50),
    siblingGap: clamp(900 / count, 24, 80),
    depthGap: 110,
    fitPadding: 48 + 2 * Math.sqrt(count),
    zoomScaleExtent: [Math.min(0.05, 40 / Math.max(viewportWidth, viewportHeight)), 6],
  };
}

export interface GroupCentroid {
  x: number;
  y: number;
}

export function groupCentroids<T>(
  nodes: T[],
  groupId: (node: T) => string,
  width: number,
  height: number,
): Map<string, GroupCentroid> {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    const id = groupId(node);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const ids = Array.from(counts.keys()).sort();
  const columns = Math.max(1, Math.min(ids.length, Math.ceil(Math.sqrt(ids.length * width / Math.max(height, 1)))));
  const rows = Math.ceil(ids.length / columns);
  const largestGroup = Math.max(1, ...counts.values());
  const spacing = Math.max(240, Math.sqrt(largestGroup) * 70);
  return new Map(ids.map((id, index) => [id, {
    x: width / 2 + (index % columns - (columns - 1) / 2) * spacing,
    y: height / 2 + (Math.floor(index / columns) - (rows - 1) / 2) * spacing,
  }]));
}

export function seedGroupPositions<T extends ForceLayoutNode>(
  nodes: SimNodeDatum<T>[],
  groupId: (node: T) => string,
  centers: Map<string, GroupCentroid>,
) {
  for (const node of nodes) {
    if (hasFinitePosition(node)) continue;
    const center = centers.get(groupId(node));
    if (!center) continue;
    const angle = stableUnitValue(node.id) * Math.PI * 2;
    const radius = 24 + stableUnitValue(`${node.id}:radius`) * 72;
    node.x = center.x + Math.cos(angle) * radius;
    node.y = center.y + Math.sin(angle) * radius;
  }
}

export function partitionGraphEdges<
  T extends ForceLayoutNode,
  E extends { source: string; target: string },
>(nodes: T[], edges: E[]): { edges: E[]; hiddenRelationshipCount: number } {
  const ids = new Set(nodes.map((node) => node.id));
  const resolved = edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
  return { edges: resolved, hiddenRelationshipCount: edges.length - resolved.length };
}

export function countHiddenRelationships<
  T extends ForceLayoutNode,
  E extends { source: string; target: string },
>(
  nodes: T[],
  edges: E[],
  nodeVisible: (node: T) => boolean = () => true,
  edgeVisible: (edge: E) => boolean = () => true,
  alreadyHidden = 0,
): number {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  let missing = 0;
  let filtered = 0;
  for (const edge of edges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target) missing += 1;
    else if (!nodeVisible(source) || !nodeVisible(target) || !edgeVisible(edge)) filtered += 1;
  }
  return Math.max(missing, alreadyHidden) + filtered;
}

export function fitGraphTransform(
  positions: { x: number; y: number }[],
  width: number,
  height: number,
  padding: number,
  maxScale = 2,
): d3.ZoomTransform | null {
  if (positions.length === 0) return null;
  const minX = d3.min(positions, (node) => node.x) ?? 0;
  const maxX = d3.max(positions, (node) => node.x) ?? 0;
  const minY = d3.min(positions, (node) => node.y) ?? 0;
  const maxY = d3.max(positions, (node) => node.y) ?? 0;
  const graphWidth = Math.max(maxX - minX, 1);
  const graphHeight = Math.max(maxY - minY, 1);
  const inset = Math.min(padding, Math.min(width, height) / 3);
  const scale = Math.max(Number.EPSILON, Math.min(
    maxScale,
    (width - inset * 2) / graphWidth,
    (height - inset * 2) / graphHeight,
  ));
  return d3.zoomIdentity
    .translate(width / 2 - (minX + graphWidth / 2) * scale, height / 2 - (minY + graphHeight / 2) * scale)
    .scale(scale);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function useForceLayout<
  T extends ForceLayoutNode,
  L extends d3.SimulationLinkDatum<SimNodeDatum<T>>,
>(svgRef: () => SVGSVGElement | undefined, options: ForceLayoutOptions = {}) {
  let sim: d3.Simulation<SimNodeDatum<T>, L> | null = null;
  let zoomBehavior: d3.ZoomBehavior<SVGSVGElement, unknown> | null = null;
  let nodeById = new Map<string, SimNodeDatum<T>>();
  let prevNodeById = new Map<string, SimNodeDatum<T>>();

  function prepare(sourceNodes: T[]): ForceLayoutBuild<T> | null {
    const el = svgRef();
    stop();
    if (!el) return null;

    const zoomTransform = d3.zoomTransform(el);
    d3.select(el).selectAll('*').remove();

    const bounds = el.getBoundingClientRect();
    const width = Math.max(bounds.width || el.clientWidth, 320);
    const height = Math.max(bounds.height || el.clientHeight, 240);
    const simNodes = createSimNodes(
      sourceNodes,
      options.pinnedNodeIds?.() ?? new Set<string>(),
      prevNodeById,
    );
    nodeById = new Map(simNodes.map((node) => [node.id, node]));

    const svg = d3.select<SVGSVGElement, unknown>(el);
    const container = svg
      .append('g')
      .attr('class', 'graph-viewport')
      .attr('transform', zoomTransform.toString());
    zoomBehavior = d3
      .zoom<SVGSVGElement, unknown>()
      .extent([[0, 0], [width, height]])
      .clickDistance(4)
      .scaleExtent(scaleFor(simNodes.length, width, height).zoomScaleExtent)
      .on('zoom', (event) => container.attr('transform', event.transform));
    svg.call(zoomBehavior);

    return {
      svg,
      container,
      width,
      height,
      simNodes,
      nodeById,
    };
  }

  function createDragBehavior() {
    return d3
      .drag<SVGGElement, SimNodeDatum<T>>()
      .clickDistance(4)
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
  }

  function setSimulation(next: d3.Simulation<SimNodeDatum<T>, L>) {
    sim = next;
  }

  function restart(alpha = 0.05) {
    sim?.alpha(alpha).restart();
  }

  function markBuilt() {
    prevNodeById = nodeById;
  }

  function resetZoom() {
    if (fitToGraph()) return;
    const el = svgRef();
    if (!el || !zoomBehavior) return;
    d3.select<SVGSVGElement, unknown>(el).call(
      zoomBehavior.transform,
      d3.zoomIdentity,
    );
  }

  function fitToGraph(nodeIds?: Set<string>, padding?: number): boolean {
    const el = svgRef();
    if (!el || !zoomBehavior || nodeById.size === 0) return false;
    const positioned = Array.from(nodeById.values()).filter(
      (node) =>
        Number.isFinite(node.x) &&
        Number.isFinite(node.y) &&
        (!nodeIds || nodeIds.has(node.id)),
    );
    if (positioned.length === 0) return false;

    const bounds = el.getBoundingClientRect();
    const width = Math.max(bounds.width || el.clientWidth, 320);
    const height = Math.max(bounds.height || el.clientHeight, 240);
    const calibration = scaleFor(positioned.length, width, height);
    const transform = fitGraphTransform(
      positioned.map((node) => ({ x: node.x!, y: node.y! })),
      width,
      height,
      padding ?? calibration.fitPadding,
      options.maxFitScale,
    );
    if (!transform) return false;
    // A large, closed graph must remain fully reachable even when its fit
    // scale is smaller than the usual manual zoom minimum.
    zoomBehavior.scaleExtent([
      Math.min(transform.k, calibration.zoomScaleExtent[0]),
      calibration.zoomScaleExtent[1],
    ]);

    d3.select<SVGSVGElement, unknown>(el).call(
      zoomBehavior.transform,
      transform,
    );
    return true;
  }

  function stop() {
    sim?.stop();
    sim = null;
  }

  onCleanup(stop);

  return {
    prepare,
    createDragBehavior,
    setSimulation,
    restart,
    markBuilt,
    resetZoom,
    fitToGraph,
    stop,
    nodeById: () => nodeById,
  };
}

export function createSimNodes<T extends ForceLayoutNode>(
  sourceNodes: T[],
  pinned: Set<string>,
  previousNodeById: Map<string, SimNodeDatum<T>>,
): SimNodeDatum<T>[] {
  return sourceNodes.map((node) => {
    const next: SimNodeDatum<T> = { ...node };
    const previous = previousNodeById.get(node.id);
    const previousPosition = finitePosition(previous?.x, previous?.y);

    if (previousPosition) {
      next.x = previousPosition.x;
      next.y = previousPosition.y;
    }

    if (pinned.has(node.id)) {
      const pinnedPosition =
        finitePosition(previous?.fx, previous?.fy) ?? previousPosition;
      if (pinnedPosition) {
        next.x = pinnedPosition.x;
        next.y = pinnedPosition.y;
        next.fx = pinnedPosition.x;
        next.fy = pinnedPosition.y;
      }
    }

    return next;
  });
}

function hasFinitePosition<T extends ForceLayoutNode>(
  node: SimNodeDatum<T> | undefined,
): node is SimNodeDatum<T> & { x: number; y: number } {
  return finitePosition(node?.x, node?.y) !== null;
}

function finitePosition(
  x: number | null | undefined,
  y: number | null | undefined,
): { x: number; y: number } | null {
  return Number.isFinite(x) && Number.isFinite(y)
    ? { x: x as number, y: y as number }
    : null;
}

export function finiteCoord(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function stableUnitValue(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return (hash % 997) / 996;
}
