import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, LocateFixed, Minus, Plus } from 'lucide-solid';
import type { Accessor } from 'solid-js';

export interface GraphNavigationApi {
  resetZoom: () => void;
  zoomBy: (factor: number) => void;
  panBy: (x: number, y: number) => void;
  zoomScale: Accessor<number>;
}

export function GraphNavigation(props: { graph: GraphNavigationApi | null }) {
  return (
    <div class="graph-navigation" role="group" aria-label="Graph navigation">
      <button type="button" class="btn btn-ghost" aria-label="Zoom out" disabled={!props.graph} onClick={() => props.graph?.zoomBy(1 / 1.25)}>
        <Minus size={16} aria-hidden="true" />
      </button>
      <output class="graph-zoom-level" aria-label="Zoom level">{Math.round((props.graph?.zoomScale() ?? 1) * 100)}%</output>
      <button type="button" class="btn btn-ghost" aria-label="Zoom in" disabled={!props.graph} onClick={() => props.graph?.zoomBy(1.25)}>
        <Plus size={16} aria-hidden="true" />
      </button>
      <button type="button" class="btn btn-ghost" aria-label="Reset view" title="Fit graph (R)" disabled={!props.graph} onClick={() => props.graph?.resetZoom()}>
        <LocateFixed size={16} aria-hidden="true" />
      </button>
      <div class="graph-pan-controls" role="group" aria-label="Pan graph">
        <button type="button" class="btn btn-ghost" aria-label="Pan left" disabled={!props.graph} onClick={() => props.graph?.panBy(80, 0)}><ArrowLeft size={14} aria-hidden="true" /></button>
        <button type="button" class="btn btn-ghost" aria-label="Pan up" disabled={!props.graph} onClick={() => props.graph?.panBy(0, 80)}><ArrowUp size={14} aria-hidden="true" /></button>
        <button type="button" class="btn btn-ghost" aria-label="Pan down" disabled={!props.graph} onClick={() => props.graph?.panBy(0, -80)}><ArrowDown size={14} aria-hidden="true" /></button>
        <button type="button" class="btn btn-ghost" aria-label="Pan right" disabled={!props.graph} onClick={() => props.graph?.panBy(-80, 0)}><ArrowRight size={14} aria-hidden="true" /></button>
      </div>
    </div>
  );
}
