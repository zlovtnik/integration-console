declare module 'd3-force-3d' {
  export interface SimulationNodeDatum {
    index?: number;
    x?: number;
    y?: number;
    z?: number;
    vx?: number;
    vy?: number;
    vz?: number;
    fx?: number | null;
    fy?: number | null;
    fz?: number | null;
  }

  export interface SimulationLinkDatum<NodeDatum extends SimulationNodeDatum> {
    source: string | number | NodeDatum;
    target: string | number | NodeDatum;
    index?: number;
  }

  export interface Force<NodeDatum extends SimulationNodeDatum> {
    (alpha: number): void;
    initialize?(nodes: NodeDatum[], random?: () => number): void;
  }

  export interface Simulation<
    NodeDatum extends SimulationNodeDatum,
    LinkDatum extends SimulationLinkDatum<NodeDatum>,
  > {
    alpha(): number;
    alpha(value: number): this;
    alphaDecay(): number;
    alphaDecay(value: number): this;
    force(name: string): Force<NodeDatum> | undefined;
    force(name: string, force: Force<NodeDatum> | null): this;
    nodes(): NodeDatum[];
    nodes(nodes: NodeDatum[]): this;
    on(type: 'tick' | 'end', listener: (() => void) | null): this;
    restart(): this;
    stop(): this;
    tick(iterations?: number): this;
  }

  export interface ForceLink<
    NodeDatum extends SimulationNodeDatum,
    LinkDatum extends SimulationLinkDatum<NodeDatum>,
  > extends Force<NodeDatum> {
    id(id: (node: NodeDatum) => string): this;
    distance(distance: number | ((link: LinkDatum) => number)): this;
    strength(strength: number | ((link: LinkDatum) => number)): this;
    links(): LinkDatum[];
    links(links: LinkDatum[]): this;
  }

  export interface ForceManyBody<NodeDatum extends SimulationNodeDatum>
    extends Force<NodeDatum> {
    strength(strength: number | ((node: NodeDatum) => number)): this;
  }

  export interface ForceCenter<NodeDatum extends SimulationNodeDatum>
    extends Force<NodeDatum> {
    x(x: number): this;
    y(y: number): this;
    z(z: number): this;
  }

  export interface ForceCollide<NodeDatum extends SimulationNodeDatum>
    extends Force<NodeDatum> {
    radius(radius: number | ((node: NodeDatum) => number)): this;
    strength(strength: number): this;
    iterations(iterations: number): this;
  }

  export function forceSimulation<
    NodeDatum extends SimulationNodeDatum,
    LinkDatum extends SimulationLinkDatum<NodeDatum> = SimulationLinkDatum<NodeDatum>,
  >(nodes?: NodeDatum[], numDimensions?: number): Simulation<NodeDatum, LinkDatum>;

  export function forceLink<
    NodeDatum extends SimulationNodeDatum,
    LinkDatum extends SimulationLinkDatum<NodeDatum>,
  >(links?: LinkDatum[]): ForceLink<NodeDatum, LinkDatum>;

  export function forceManyBody<
    NodeDatum extends SimulationNodeDatum,
  >(): ForceManyBody<NodeDatum>;

  export function forceCenter<NodeDatum extends SimulationNodeDatum>(
    x?: number,
    y?: number,
    z?: number,
  ): ForceCenter<NodeDatum>;

  export function forceCollide<NodeDatum extends SimulationNodeDatum>(
    radius?: number | ((node: NodeDatum) => number),
  ): ForceCollide<NodeDatum>;
}
