import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force-3d';
import { createEffect, on, onCleanup, onMount } from 'solid-js';
import * as THREE from 'three';
import type { InventoryEdge, InventoryNode, InventoryNodeKind } from '~/api/types';
import {
  buildInventoryRenderModel,
  inventoryEdgeColor,
  inventoryLinkDistance,
  inventoryNodeColor,
  inventoryNodeRadius,
  type InventoryGraphOptions,
  type InventoryGrouping,
  type InventoryRenderNode,
} from './useInventoryGraph';
import { stableUnitValue } from './useForceLayout';

interface Inventory3dNode extends InventoryRenderNode, SimulationNodeDatum {}

interface Inventory3dEdge extends SimulationLinkDatum<Inventory3dNode> {
  id: string;
  source: string | Inventory3dNode;
  target: string | Inventory3dNode;
  kind: InventoryEdge['kind'];
  weight?: number;
}

interface NodeVisual {
  node: Inventory3dNode;
  mesh: THREE.Mesh;
}

interface EdgeVisual {
  edge: Inventory3dEdge;
  line: THREE.Line;
}

const DEFAULT_CAMERA_Z = 420;
const DEFAULT_ROTATION_X = -0.28;
const DEFAULT_ROTATION_Y = 0.44;
const MAX_PIXEL_RATIO = 2;

export function useInventoryGraph3d(
  hostRef: () => HTMLDivElement | undefined,
  nodes: () => InventoryNode[],
  edges: () => InventoryEdge[],
  options: InventoryGraphOptions = {},
) {
  let renderer: THREE.WebGLRenderer | null = null;
  let scene: THREE.Scene | null = null;
  let camera: THREE.PerspectiveCamera | null = null;
  let graphGroup: THREE.Group | null = null;
  let simulation: Simulation<Inventory3dNode, Inventory3dEdge> | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let animationFrame = 0;
  let renderedEdges: InventoryEdge[] = [];
  let nodeVisuals = new Map<string, NodeVisual>();
  let edgeVisuals: EdgeVisual[] = [];
  let previousPositions = new Map<string, THREE.Vector3>();
  let hoveredNodeId: string | null = null;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const disposers: Array<() => void> = [];

  function build() {
    stop();
    const host = hostRef();
    if (!host) return;

    const bounds = host.getBoundingClientRect();
    const width = Math.max(bounds.width || host.clientWidth, 320);
    const height = Math.max(bounds.height || host.clientHeight, 240);
    const model = buildInventoryRenderModel(
      nodes(),
      edges(),
      options.grouping?.() ?? 'registry',
      options.expandedGroupIds?.() ?? new Set<string>(),
      options.aggregateThreshold,
    );

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(48, width / height, 1, 5000);
    graphGroup = new THREE.Group();
    graphGroup.rotation.x = DEFAULT_ROTATION_X;
    graphGroup.rotation.y = DEFAULT_ROTATION_Y;
    scene.add(graphGroup);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    renderer.setSize(width, height, false);
    renderer.domElement.className = 'inventory-3d-canvas';
    host.replaceChildren(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.68));
    const key = new THREE.DirectionalLight(0xffffff, 1.45);
    key.position.set(160, 220, 260);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x8fb7ff, 0.7);
    fill.position.set(-240, -80, 180);
    scene.add(fill);

    const simNodes = create3dNodes(
      model.nodes,
      options.pinnedNodeIds?.() ?? new Set<string>(),
      previousPositions,
    );
    const nodeById = new Map(simNodes.map((node) => [node.id, node]));
    renderedEdges = model.edges.filter(
      (edge) => nodeById.has(edge.source) && nodeById.has(edge.target),
    );
    const simEdges = renderedEdges.map((edge): Inventory3dEdge => {
      const next: Inventory3dEdge = {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        kind: edge.kind,
      };
      if (edge.weight !== undefined) next.weight = edge.weight;
      return next;
    });

    for (const edge of simEdges) {
      const line = createEdgeLine(edge, host);
      graphGroup.add(line);
      edgeVisuals.push({ edge, line });
    }

    for (const node of simNodes) {
      const mesh = createNodeMesh(node, host);
      mesh.userData.nodeId = node.id;
      graphGroup.add(mesh);
      nodeVisuals.set(node.id, { node, mesh });
    }

    simulation = forceSimulation<Inventory3dNode, Inventory3dEdge>(simNodes, 3)
      .force(
        'link',
        forceLink<Inventory3dNode, Inventory3dEdge>(simEdges)
          .id((node) => node.id)
          .distance((edge) => inventoryLinkDistance(edge.kind) * 1.45)
          .strength(0.3),
      )
      .force('charge', forceManyBody<Inventory3dNode>().strength(-110))
      .force('center', forceCenter<Inventory3dNode>(0, 0, 0))
      .force(
        'collide',
        forceCollide<Inventory3dNode>(
          (node) => inventoryNodeRadius(node) * 2.2 + 12,
        )
          .strength(0.8)
          .iterations(2),
      )
      .alphaDecay(0.035)
      .on('tick', updateSceneObjects)
      .on('end', () => frameCamera(false));

    wireInteractions(host, renderer.domElement);
    observeResize(host);
    applyVisibility();
    applySelection();
    frameCamera(true);
    animate();
  }

  function createNodeMesh(node: Inventory3dNode, host: HTMLElement): THREE.Mesh {
    const radius = Math.max(5, inventoryNodeRadius(node) * 1.75);
    const geometry =
      node.kind === 'device'
        ? new THREE.OctahedronGeometry(radius, 0)
        : new THREE.SphereGeometry(radius, 18, 12);
    const material = new THREE.MeshStandardMaterial({
      color: resolveColor(host, inventoryNodeColor(node), fallbackNodeColor(node.kind)),
      emissive: resolveColor(host, inventoryNodeColor(node), '#ffffff'),
      emissiveIntensity: node.kind === 'merge_candidate' ? 0.24 : 0.1,
      metalness: 0.12,
      roughness: 0.58,
      transparent: true,
      opacity: node.active ? 0.96 : 0.44,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(finite3d(node.x), finite3d(node.y), finite3d(node.z));
    return mesh;
  }

  function createEdgeLine(edge: Inventory3dEdge, host: HTMLElement): THREE.Line {
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(),
      new THREE.Vector3(),
    ]);
    const material = new THREE.LineBasicMaterial({
      color: resolveColor(host, inventoryEdgeColor(edge.kind), fallbackEdgeColor(edge.kind)),
      transparent: true,
      opacity: Math.min(0.8, 0.32 + (edge.weight ?? 1) * 0.2),
    });
    return new THREE.Line(geometry, material);
  }

  function wireInteractions(host: HTMLElement, canvas: HTMLCanvasElement) {
    let dragging = false;
    let moved = false;
    let mode: 'rotate' | 'pan' = 'rotate';
    let lastX = 0;
    let lastY = 0;
    let pointerId = 0;

    const onPointerDown = (event: PointerEvent) => {
      dragging = true;
      moved = false;
      pointerId = event.pointerId;
      mode = event.button === 2 || event.shiftKey ? 'pan' : 'rotate';
      lastX = event.clientX;
      lastY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
      event.preventDefault();
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!dragging || event.pointerId !== pointerId) {
        updateHover(host, event);
        return;
      }
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      lastX = event.clientX;
      lastY = event.clientY;
      if (mode === 'pan') {
        panCamera(dx, dy);
      } else {
        rotateGraph(dx, dy);
      }
      event.preventDefault();
    };
    const onPointerUp = (event: PointerEvent) => {
      if (!dragging || event.pointerId !== pointerId) return;
      dragging = false;
      canvas.releasePointerCapture(event.pointerId);
      if (!moved) selectAtPointer(host, event);
      event.preventDefault();
    };
    const onPointerLeave = () => {
      hoveredNodeId = null;
      canvas.style.cursor = 'grab';
    };
    const onWheel = (event: WheelEvent) => {
      if (!camera) return;
      camera.position.z = clamp(
        camera.position.z * Math.exp(event.deltaY * 0.001),
        120,
        1800,
      );
      event.preventDefault();
    };
    const onContextMenu = (event: MouseEvent) => event.preventDefault();

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContextMenu);
    canvas.style.cursor = 'grab';
    disposers.push(
      () => canvas.removeEventListener('pointerdown', onPointerDown),
      () => canvas.removeEventListener('pointermove', onPointerMove),
      () => canvas.removeEventListener('pointerup', onPointerUp),
      () => canvas.removeEventListener('pointerleave', onPointerLeave),
      () => canvas.removeEventListener('wheel', onWheel),
      () => canvas.removeEventListener('contextmenu', onContextMenu),
    );
  }

  function observeResize(host: HTMLDivElement) {
    resizeObserver = new ResizeObserver(() => {
      if (!renderer || !camera) return;
      const bounds = host.getBoundingClientRect();
      const width = Math.max(bounds.width || host.clientWidth, 320);
      const height = Math.max(bounds.height || host.clientHeight, 240);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    });
    resizeObserver.observe(host);
  }

  function updateSceneObjects() {
    for (const visual of nodeVisuals.values()) {
      visual.mesh.position.set(
        finite3d(visual.node.x),
        finite3d(visual.node.y),
        finite3d(visual.node.z),
      );
    }
    for (const visual of edgeVisuals) {
      const source = visual.edge.source as Inventory3dNode;
      const target = visual.edge.target as Inventory3dNode;
      visual.line.geometry.setFromPoints([
        new THREE.Vector3(finite3d(source.x), finite3d(source.y), finite3d(source.z)),
        new THREE.Vector3(finite3d(target.x), finite3d(target.y), finite3d(target.z)),
      ]);
    }
  }

  function applyVisibility(visible = options.visibleKinds?.()) {
    if (!visible) return;
    for (const visual of nodeVisuals.values()) {
      visual.mesh.visible = visible.has(visual.node.kind);
    }
    for (const visual of edgeVisuals) {
      visual.line.visible =
        visible.has(endpointKind(visual.edge.source)) &&
        visible.has(endpointKind(visual.edge.target));
    }
  }

  function applySelection(selected = options.selectedNodeId?.() ?? null) {
    const related = new Set<string>();
    if (selected) {
      related.add(selected);
      for (const edge of renderedEdges) {
        if (edge.source === selected) related.add(edge.target);
        if (edge.target === selected) related.add(edge.source);
      }
    }

    for (const visual of nodeVisuals.values()) {
      const material = visual.mesh.material as THREE.MeshStandardMaterial;
      if (!selected) {
        material.opacity = visual.node.active ? 0.96 : 0.44;
        material.emissiveIntensity =
          visual.node.id === hoveredNodeId || visual.node.kind === 'merge_candidate'
            ? 0.24
            : 0.1;
        continue;
      }
      if (visual.node.id === selected) {
        material.opacity = 1;
        material.emissiveIntensity = 0.42;
      } else if (related.has(visual.node.id)) {
        material.opacity = 0.86;
        material.emissiveIntensity = 0.2;
      } else {
        material.opacity = 0.16;
        material.emissiveIntensity = 0.04;
      }
    }

    for (const visual of edgeVisuals) {
      const material = visual.line.material as THREE.LineBasicMaterial;
      if (!selected) {
        material.opacity = Math.min(0.8, 0.32 + (visual.edge.weight ?? 1) * 0.2);
        continue;
      }
      material.opacity =
        endpointId(visual.edge.source) === selected ||
        endpointId(visual.edge.target) === selected
          ? 0.92
          : 0.08;
    }
  }

  function rotateGraph(dx: number, dy: number) {
    if (!graphGroup) return;
    graphGroup.rotation.y += dx * 0.006;
    graphGroup.rotation.x = clamp(graphGroup.rotation.x + dy * 0.006, -1.25, 1.25);
  }

  function panCamera(dx: number, dy: number) {
    if (!camera) return;
    const scale = camera.position.z / DEFAULT_CAMERA_Z;
    camera.position.x -= dx * 0.45 * scale;
    camera.position.y += dy * 0.45 * scale;
  }

  function updateHover(host: HTMLElement, event: PointerEvent) {
    const visual = visualAtPointer(host, event);
    hoveredNodeId = visual?.node.id ?? null;
    renderer?.domElement.style.setProperty(
      'cursor',
      visual ? 'pointer' : 'grab',
    );
    applySelection();
  }

  function selectAtPointer(host: HTMLElement, event: PointerEvent) {
    const visual = visualAtPointer(host, event);
    if (!visual) return;
    if (visual.node.aggregate_group_id) {
      options.onAggregateClick?.(visual.node.aggregate_group_id);
      return;
    }
    options.onNodeClick?.(visual.node);
  }

  function visualAtPointer(
    host: HTMLElement,
    event: PointerEvent,
  ): NodeVisual | null {
    if (!camera || !graphGroup) return null;
    const bounds = host.getBoundingClientRect();
    pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    pointer.y = -(((event.clientY - bounds.top) / bounds.height) * 2 - 1);
    raycaster.setFromCamera(pointer, camera);
    const meshes = Array.from(nodeVisuals.values())
      .map((visual) => visual.mesh)
      .filter((mesh) => mesh.visible);
    const [hit] = raycaster.intersectObjects(meshes, false);
    if (!hit) return null;
    const nodeId = hit.object.userData.nodeId as string | undefined;
    return nodeId ? (nodeVisuals.get(nodeId) ?? null) : null;
  }

  function frameCamera(immediate: boolean) {
    if (!camera || !graphGroup) return;
    camera.position.x = 0;
    camera.position.y = 0;
    graphGroup.rotation.x = DEFAULT_ROTATION_X;
    graphGroup.rotation.y = DEFAULT_ROTATION_Y;
    const radius = graphRadius();
    camera.position.z = clamp(radius * 2.45, 220, 1050);
    if (immediate) updateSceneObjects();
  }

  function resetZoom() {
    frameCamera(true);
  }

  function graphRadius(): number {
    let max = 0;
    for (const visual of nodeVisuals.values()) {
      max = Math.max(max, visual.mesh.position.length());
    }
    return Math.max(max, 90);
  }

  function animate() {
    if (!renderer || !scene || !camera) return;
    renderer.render(scene, camera);
    animationFrame = window.requestAnimationFrame(animate);
  }

  function stop() {
    simulation?.stop();
    simulation = null;
    if (animationFrame) {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    }
    resizeObserver?.disconnect();
    resizeObserver = null;
    while (disposers.length > 0) disposers.pop()?.();

    previousPositions = new Map(
      Array.from(nodeVisuals.values()).map((visual) => [
        visual.node.id,
        visual.mesh.position.clone(),
      ]),
    );
    for (const visual of nodeVisuals.values()) disposeObject(visual.mesh);
    for (const visual of edgeVisuals) disposeObject(visual.line);
    nodeVisuals = new Map<string, NodeVisual>();
    edgeVisuals = [];
    renderer?.dispose();
    const host = hostRef();
    if (host && renderer?.domElement.parentElement === host) host.replaceChildren();
    renderer = null;
    scene = null;
    camera = null;
    graphGroup = null;
    hoveredNodeId = null;
  }

  function endpointKind(value: string | Inventory3dNode): InventoryNodeKind {
    if (typeof value === 'string') {
      return nodeVisuals.get(value)?.node.kind ?? 'device';
    }
    return value.kind;
  }

  function endpointId(value: string | Inventory3dNode): string {
    return typeof value === 'string' ? value : value.id;
  }

  onMount(build);
  createEffect(on(() => options.visibleKinds?.(), applyVisibility));
  createEffect(on(() => options.selectedNodeId?.() ?? null, applySelection));
  createEffect(on(() => options.pinnedNodeIds?.(), () => build()));
  onCleanup(stop);

  return { rebuild: build, resetZoom, stop };
}

function create3dNodes(
  nodes: InventoryRenderNode[],
  pinned: Set<string>,
  previousPositions: Map<string, THREE.Vector3>,
): Inventory3dNode[] {
  return nodes.map((node) => {
    const previous = previousPositions.get(node.id);
    const seedA = stableUnitValue(`${node.id}:a`);
    const seedB = stableUnitValue(`${node.id}:b`);
    const seedC = stableUnitValue(`${node.id}:c`);
    const next: Inventory3dNode = {
      ...node,
      x: previous?.x ?? (seedA - 0.5) * 260,
      y: previous?.y ?? (seedB - 0.5) * 220,
      z: previous?.z ?? (seedC - 0.5) * 180,
    };
    if (pinned.has(node.id)) {
      next.fx = finite3d(next.x);
      next.fy = finite3d(next.y);
      next.fz = finite3d(next.z);
    }
    return next;
  });
}

function disposeObject(object: THREE.Object3D) {
  const mesh = object as THREE.Mesh | THREE.Line;
  mesh.geometry?.dispose();
  const material = mesh.material;
  if (Array.isArray(material)) {
    for (const item of material) item.dispose();
  } else {
    material?.dispose();
  }
}

function resolveColor(host: HTMLElement, value: string, fallback: string): THREE.Color {
  const resolved = value.startsWith('var(')
    ? getComputedStyle(host).getPropertyValue(value.slice(4, -1)).trim() ||
      getComputedStyle(document.documentElement)
        .getPropertyValue(value.slice(4, -1))
        .trim()
    : value;
  try {
    return new THREE.Color(resolved || fallback);
  } catch {
    return new THREE.Color(fallback);
  }
}

function fallbackNodeColor(kind: InventoryNodeKind): string {
  switch (kind) {
    case 'owner':
      return '#7ab7ff';
    case 'location_asset':
      return '#7ddc96';
    case 'cluster':
      return '#b6a0ff';
    case 'merge_candidate':
      return '#f0b45f';
    default:
      return '#62d4ff';
  }
}

function fallbackEdgeColor(kind: InventoryEdge['kind']): string {
  switch (kind) {
    case 'owns':
      return '#7ab7ff';
    case 'located_at':
      return '#7ddc96';
    case 'cluster_member':
      return '#b6a0ff';
    case 'merge_candidate':
      return '#f0b45f';
    case 'same_device':
      return '#ff7878';
    default:
      return '#758297';
  }
}

function finite3d(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
