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
      .scaleExtent([0.05, 6])
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

  function fitToGraph(nodeIds?: Set<string>, padding = 56): boolean {
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
    const minX = d3.min(positioned, (node) => node.x ?? 0) ?? 0;
    const maxX = d3.max(positioned, (node) => node.x ?? 0) ?? 0;
    const minY = d3.min(positioned, (node) => node.y ?? 0) ?? 0;
    const maxY = d3.max(positioned, (node) => node.y ?? 0) ?? 0;
    const graphWidth = Math.max(maxX - minX, 1);
    const graphHeight = Math.max(maxY - minY, 1);
    const scale = Math.max(
      0.12,
      Math.min(
        2,
        (width - padding * 2) / graphWidth,
        (height - padding * 2) / graphHeight,
      ),
    );
    const centerX = minX + graphWidth / 2;
    const centerY = minY + graphHeight / 2;
    const transform = d3.zoomIdentity
      .translate(width / 2 - centerX * scale, height / 2 - centerY * scale)
      .scale(scale);

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
