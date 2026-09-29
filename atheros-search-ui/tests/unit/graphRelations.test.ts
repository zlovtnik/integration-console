import { describe, expect, it } from 'vitest';
import type { GraphEdge, GraphNode } from '~/api/types';
import {
  buildGraphRelationIndex,
  isDeviceLike,
  relatedDevices,
  relatedNodes,
  relatedOfKind,
  summarizeGraphNodes,
} from '~/utils/graphRelations';

function node(
  id: string,
  kind: GraphNode['kind'],
  overrides: Partial<GraphNode> = {},
): GraphNode {
  return { id, kind, label: id, ...overrides };
}

function edge(
  id: string,
  source: string,
  target: string,
  kind: GraphEdge['kind'],
  overrides: Partial<GraphEdge> = {},
): GraphEdge {
  return { id, source, target, kind, ...overrides };
}

const cluster = node('cluster:lab', 'cluster', { label: 'Lab cluster' });
const ap = node('ap:lab', 'ap', { label: 'Lab AP', bssid: '22:33:44:55:66:77' });
const laptop = node('device:aa', 'device', {
  label: 'Laptop',
  mac: 'aa:bb:cc:dd:ee:ff',
  display_name: 'Laptop',
  location_id: 'lab',
  sensor_id: 'sensor-a',
  first_seen: '2026-09-01T00:00:00Z',
  last_seen: '2026-09-10T00:00:00Z',
  tags: ['registered'],
});
const phone = node('device:bb', 'device', {
  label: 'Phone',
  mac: '11:22:33:44:55:66',
  location_id: 'warehouse',
  sensor_id: 'sensor-b',
  first_seen: '2026-08-01T00:00:00Z',
  last_seen: '2026-09-12T00:00:00Z',
});
const client = node('client:guest', 'client', {
  label: 'guest-net client',
  mac: '66:55:44:33:22:11',
  ssid: 'guest-net',
  location_id: 'guest',
});
const alert = node('alert:1', 'alert', { label: 'Shadow alert' });

const nodes = [cluster, ap, laptop, phone, client, alert];
const edges = [
  edge('cluster_member:1', 'device:aa', 'cluster:lab', 'cluster_member'),
  edge('association:1', 'device:aa', 'ap:lab', 'association', {
    weight: 2,
    weight_basis: 'searchable_record_count',
  }),
  edge('association:2', 'client:guest', 'ap:lab', 'association'),
  edge('alert_ref:1', 'alert:1', 'device:aa', 'alert_ref', { label: 'shadow' }),
];

const index = buildGraphRelationIndex(nodes, edges);
const idsOf = (id: string) => relatedNodes(index, id).map((item) => item.node.id);

describe('buildGraphRelationIndex', () => {
  it('relates both endpoints of every edge', () => {
    expect(idsOf('device:aa')).toEqual([
      'cluster:lab',
      'ap:lab',
      'alert:1',
    ]);
    expect(idsOf('ap:lab')).toEqual(['device:aa', 'client:guest']);
  });

  it('resolves a relation to a cluster from either side', () => {
    expect(
      relatedOfKind(index, 'cluster:lab', 'cluster_member').map((n) => n.id),
    ).toEqual(['device:aa']);
    expect(
      relatedOfKind(index, 'device:aa', 'cluster_member').map((n) => n.id),
    ).toEqual(['cluster:lab']);
  });

  it('carries edge weight, basis, and label onto the relation', () => {
    const association = relatedNodes(index, 'ap:lab').find(
      (item) => item.node.id === 'device:aa',
    );
    expect(association?.weight).toBe(2);
    expect(association?.weight_basis).toBe('searchable_record_count');
    const alertRef = relatedNodes(index, 'device:aa').find(
      (item) => item.node.id === 'alert:1',
    );
    expect(alertRef?.label).toBe('shadow');
  });

  it('omits weight keys that the edge did not carry', () => {
    const relation = relatedNodes(index, 'ap:lab').find(
      (item) => item.node.id === 'client:guest',
    );
    expect(relation?.weight).toBeUndefined();
    expect('weight' in (relation ?? {})).toBe(false);
  });

  it('deduplicates repeated edges between the same pair and kind', () => {
    const duplicated = buildGraphRelationIndex(nodes, [
      ...edges,
      edge('cluster_member:dup', 'device:aa', 'cluster:lab', 'cluster_member'),
    ]);
    expect(
      relatedOfKind(duplicated, 'cluster:lab', 'cluster_member'),
    ).toHaveLength(1);
  });

  it('ignores endpoints missing from the loaded node list', () => {
    const partial = buildGraphRelationIndex([ap], [
      edge('association:1', 'device:gone', 'ap:lab', 'association'),
    ]);
    expect(relatedNodes(partial, 'ap:lab')).toEqual([]);
  });

  it('reports edgesLoaded so an empty response is distinguishable from no neighbours', () => {
    expect(index.edgesLoaded).toBe(true);
    expect(buildGraphRelationIndex(nodes, []).edgesLoaded).toBe(false);
  });
});

describe('relatedDevices', () => {
  it('keeps only identifier-bearing relations', () => {
    expect(
      relatedDevices(index, 'ap:lab').map((item) => item.node.id),
    ).toEqual(['device:aa', 'client:guest']);
  });

  it('drops clusters, APs, and alerts from a device', () => {
    expect(relatedDevices(index, 'device:aa')).toEqual([]);
  });
});

describe('isDeviceLike', () => {
  it('treats projected devices and SSID-scoped clients as identifiers', () => {
    expect(isDeviceLike(laptop)).toBe(true);
    expect(isDeviceLike(client)).toBe(true);
    expect(isDeviceLike(ap)).toBe(false);
    expect(isDeviceLike(cluster)).toBe(false);
  });
});

describe('summarizeGraphNodes', () => {
  const summary = summarizeGraphNodes([laptop, phone]);

  it('counts identifiers and tallies projection dimensions', () => {
    expect(summary.total).toBe(2);
    expect(summary.locations).toBe('lab (1), warehouse (1)');
    expect(summary.sensors).toBe('sensor-a (1), sensor-b (1)');
    expect(summary.tags).toBe('registered (1)');
  });

  it('reports the earliest and latest observed windows', () => {
    expect(summary.earliestFirstSeen).toBe('2026-08-01T00:00:00Z');
    expect(summary.latestLastSeen).toBe('2026-09-12T00:00:00Z');
  });

  it('does not claim owner, registration, or alias data the projection lacks', () => {
    expect(Object.keys(summary)).toEqual([
      'total',
      'locations',
      'sensors',
      'ssids',
      'earliestFirstSeen',
      'latestLastSeen',
      'tags',
    ]);
  });

  it('summarises an empty set without inventing values', () => {
    const empty = summarizeGraphNodes([]);
    expect(empty.total).toBe(0);
    expect(empty.locations).toBe('');
    expect(empty.earliestFirstSeen).toBeUndefined();
  });
});
