import * as d3 from 'd3';
import { createUniqueId, onCleanup } from 'solid-js';
import { render } from 'solid-js/web';
import { GitMerge, MapPin, UserRound, Wifi } from 'lucide-solid';

interface Node {
  id: string;
  kind: string;
  label: string;
}

interface Edge {
  source: string | { id: string };
  target: string | { id: string };
}

export function useGraphPresentation<N extends Node>(
  svgRef: () => SVGSVGElement | undefined,
  selected: () => string | null,
  onClear: () => void,
) {
  const prefix = `graph-${createUniqueId()}`;
  let hovered: string | null = null;
  let focused: string | null = null;
  let disposers: (() => void)[] = [];

  function reset() {
    disposers.forEach((dispose) => dispose());
    disposers = [];
    hovered = null;
    focused = null;
  }
  onCleanup(() => {
    reset();
    const el = svgRef();
    if (el) d3.select(el).on('.presentation', null);
  });

  function prepare(svg: d3.Selection<SVGSVGElement, unknown, null, undefined>) {
    const defs = svg.append('defs');
    for (const tone of ['danger', 'warn']) {
      const gradient = defs
        .append('radialGradient')
        .attr('id', `${prefix}-${tone}`);
      gradient
        .append('stop')
        .attr('offset', '0%')
        .attr('stop-color', `var(--graph-${tone})`)
        .attr('stop-opacity', tone === 'danger' ? 0.35 : 0.28);
      gradient
        .append('stop')
        .attr('offset', '100%')
        .attr('stop-color', `var(--graph-${tone})`)
        .attr('stop-opacity', 0);
    }
    svg.on('click.presentation', (event: MouseEvent) => {
      if (!event.defaultPrevented && event.target === svg.node()) onClear();
    });
    return defs;
  }

  function paint() {
    const el = svgRef();
    const related = new Set<string>();
    const selectedRelated = new Set<string>();
    if (!el) return related;
    const svg = d3.select(el);
    const nodes = svg.selectAll<SVGGElement, N>('.graph-node');
    const visibleIds = new Set<string>();
    nodes.each(function (node) {
      if (this.style.display !== 'none') visibleIds.add(node.id);
    });
    if (hovered && !visibleIds.has(hovered)) hovered = null;
    if (focused && !visibleIds.has(focused)) focused = null;
    const candidate = hovered ?? focused ?? selected();
    const active = candidate && visibleIds.has(candidate) ? candidate : null;
    if (active) related.add(active);
    const selection = selected();
    if (selection && visibleIds.has(selection)) selectedRelated.add(selection);
    const links = svg.selectAll<SVGLineElement, Edge>('.graph-link');
    const endpoint = (value: Edge['source']) =>
      typeof value === 'string' ? value : value.id;
    links.each(function (edge) {
      if (this.style.display === 'none') return;
      const source = endpoint(edge.source);
      const target = endpoint(edge.target);
      if (active === source || active === target) {
        related.add(source);
        related.add(target);
      }
      if (selection === source || selection === target) {
        selectedRelated.add(source);
        selectedRelated.add(target);
      }
    });
    nodes
      .classed('selected', (node) => node.id === selected())
      .attr('aria-pressed', (node) => String(node.id === selected()))
      .classed(
        'highlighted',
        (node) => node.id === hovered || node.id === focused,
      )
      .classed('related', (node) =>
        Boolean(active && node.id !== active && related.has(node.id)),
      )
      .classed('dimmed', (node) => Boolean(active && !related.has(node.id)));
    links
      .classed('selected', (edge) =>
        Boolean(
          active &&
          (endpoint(edge.source) === active ||
            endpoint(edge.target) === active),
        ),
      )
      .classed('dimmed', (edge) =>
        Boolean(
          active &&
          endpoint(edge.source) !== active &&
          endpoint(edge.target) !== active,
        ),
      );
    return selectedRelated;
  }

  function decorate(
    nodes: d3.Selection<SVGGElement, N, SVGGElement, unknown>,
    options: {
      radius: (node: N) => number;
      color: (node: N) => string;
      count: (node: N) => number | undefined;
      alwaysLabel: (node: N) => boolean;
      onHover?: ((node: N | null) => void) | undefined;
    },
  ) {
    nodes
      .on('mouseenter.presentation', (_, node) => {
        hovered = node.id;
        paint();
        options.onHover?.(node);
      })
      .on('mouseleave.presentation', () => {
        hovered = null;
        paint();
        options.onHover?.(null);
      })
      .on('focus.presentation', (_, node) => {
        focused = node.id;
        paint();
      })
      .on('blur.presentation', () => {
        focused = null;
        paint();
      });
    nodes.append('title').text((node) => node.label);
    nodes
      .filter((node) =>
        ['shadow_alert', 'alert', 'merge_candidate'].includes(node.kind),
      )
      .append('circle')
      .attr('class', 'graph-node-glow')
      .attr('aria-hidden', 'true')
      .attr('r', (node) => options.radius(node) + 18)
      .attr(
        'fill',
        (node) =>
          `url(#${prefix}-${node.kind === 'shadow_alert' ? 'danger' : 'warn'})`,
      );
    nodes
      .append('circle')
      .attr('class', 'graph-node-ring')
      .attr('r', (node) => options.radius(node) + 6)
      .attr('fill', 'none')
      .attr('stroke', options.color);
    nodes
      .append('circle')
      .attr('class', 'graph-node-body')
      .classed(
        'graph-node-body--cluster',
        (node) => node.kind === 'cluster' || node.kind === 'aggregate_group',
      )
      .attr('r', options.radius)
      .attr('fill', options.color)
      .attr('stroke', options.color);
    nodes.each(function (node) {
      const group = d3.select(this);
      const count = options.count(node);
      const symbol =
        count !== undefined
          ? String(count)
          : node.kind === 'shadow_alert'
            ? '?'
            : node.kind === 'alert'
              ? '!'
              : null;
      if (symbol !== null) {
        group
          .append('text')
          .attr('class', 'graph-node-symbol')
          .classed('graph-node-symbol--count', count !== undefined)
          .attr('aria-hidden', 'true')
          .attr('dy', '0.35em')
          .text(symbol);
      } else {
        const Icon =
          node.kind === 'ap'
            ? Wifi
            : node.kind === 'owner'
              ? UserRound
              : node.kind === 'location_asset'
                ? MapPin
                : node.kind === 'merge_candidate'
                  ? GitMerge
                  : null;
        if (Icon) {
          const host = group
            .append('g')
            .attr('class', 'graph-node-icon')
            .attr('aria-hidden', 'true')
            .attr('transform', 'translate(-7,-7)')
            .node()!;
          disposers.push(
            render(() => <Icon size={14} strokeWidth={2} />, host),
          );
        }
      }
    });
    nodes
      .append('text')
      .attr('class', 'graph-node-label')
      .classed('graph-node-label--persistent', options.alwaysLabel)
      .attr('y', (node) => options.radius(node) + 13)
      .text((node) =>
        node.label.length > 24 ? `${node.label.slice(0, 23)}...` : node.label,
      );
  }

  return { reset, prepare, decorate, paint, prefix };
}
