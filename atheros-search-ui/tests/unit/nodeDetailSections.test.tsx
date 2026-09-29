import { render, cleanup } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import type { InventoryNode } from '~/api/types';
import {
  CollapsibleNodeList,
  DERIVED_DEVICE_PREVIEW_LIMIT,
  DERIVED_DEVICES_UNAVAILABLE,
  DeviceAliasSection,
  DeviceDetailRows,
  DeviceSummaryRows,
  DerivedDeviceList,
  KindIdentityRows,
  derivedMacs,
} from '~/components/graph/NodeDetailSections';
import {
  buildInventoryRelationIndex,
  relatedDevices,
} from '~/utils/inventoryRelations';

afterEach(cleanup);

function device(mac: string, overrides: Partial<InventoryNode> = {}): InventoryNode {
  return {
    id: `device:${mac}`,
    kind: 'device',
    label: mac,
    mac,
    active: true,
    ...overrides,
  };
}

function manyDevices(count: number): InventoryNode[] {
  return Array.from({ length: count }, (_, index) =>
    device(`mac:${String(index).padStart(2, '0')}`, {
      display_name: `Device ${index}`,
      owner_id: 'security',
      registered: index % 2 === 0,
    }),
  );
}

describe('DeviceDetailRows', () => {
  it('renders the full registry join for a device', () => {
    const { getByText, getAllByText, container } = render(() => (
      <DeviceDetailRows
        node={device('aa:11', {
          display_name: 'Laptop',
          owner_id: 'security',
          location_id: 'lab',
          registered: true,
          first_registered: '2026-09-02T00:00:00Z',
          first_seen: '2026-09-01T00:00:00Z',
          last_seen: '2026-09-10T00:00:00Z',
        })}
      />
    ));
    for (const label of [
      'Display name',
      'MAC',
      'Owner',
      'Location',
      'Registry active (not online status)',
      'Registration',
      'Registered',
      'First observed',
      'Last observed (registry lifetime)',
    ]) {
      // "Registered" and "Location" appear as both a label and a value here.
      expect(getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(getByText('Laptop')).toBeTruthy();
    expect(getByText('security')).toBeTruthy();
    // Both the registration state and the registered date render the word.
    expect(getAllByText('Registered').length).toBe(2);
    expect(container.textContent).toContain('Registry active (not online status)');
  });

  it('reports unknown registration rather than assuming registered', () => {
    const { getByText, queryByText } = render(() => (
      <DeviceDetailRows node={device('bb:22')} />
    ));
    expect(getByText('Unknown')).toBeTruthy();
    expect(queryByText('Unregistered')).toBeNull();
  });

  it('reports an unregistered identifier explicitly', () => {
    const { getByText } = render(() => (
      <DeviceDetailRows node={device('bb:22', { registered: false })} />
    ));
    expect(getByText('Unregistered')).toBeTruthy();
  });
});

describe('KindIdentityRows', () => {
  it('labels an owner node by owner and a location node by location', () => {
    const owner = render(() => (
      <KindIdentityRows
        node={{
          id: 'owner:security',
          kind: 'owner',
          label: 'security',
          owner_id: 'security',
          active: true,
        }}
      />
    ));
    expect(owner.getByText('Owner')).toBeTruthy();

    const location = render(() => (
      <KindIdentityRows
        node={{
          id: 'location:lab',
          kind: 'location_asset',
          label: 'lab',
          location_id: 'lab',
          active: true,
        }}
      />
    ));
    expect(location.getByText('Location')).toBeTruthy();
  });

  it('names a cluster pending similarity and never a confirmed identity', () => {
    const { getByText, queryByText } = render(() => (
      <KindIdentityRows
        node={{
          id: 'cluster:c1',
          kind: 'cluster',
          label: 'Similarity c1',
          similarity_cluster_id: 'c1',
          active: true,
        }}
      />
    ));
    expect(getByText('Pending similarity id')).toBeTruthy();
    expect(queryByText(/Identity/i)).toBeNull();
  });

  it('shows pair confidence only for merge candidates', () => {
    const { getByText } = render(() => (
      <KindIdentityRows
        node={{
          id: 'merge:c1',
          kind: 'merge_candidate',
          label: 'a / b',
          dedup_confidence: 0.82,
          active: true,
        }}
      />
    ));
    expect(getByText('Pair confidence (0 to 1)')).toBeTruthy();
  });
});

describe('DeviceAliasSection', () => {
  it('states that a single recorded MAC means no aliases are retained', () => {
    const { getByText } = render(() => (
      <DeviceAliasSection node={device('aa:11', { known_macs: ['aa:11'] })} />
    ));
    expect(getByText(/No alias MACs are retained/)).toBeTruthy();
  });

  it('lists every recorded alias', () => {
    const { getByText, queryByText } = render(() => (
      <DeviceAliasSection node={device('aa:11', { known_macs: ['aa:11', 'aa:11:alt'] })} />
    ));
    expect(getByText('aa:11:alt')).toBeTruthy();
    expect(queryByText(/No alias MACs are retained/)).toBeNull();
  });

  it('renders nothing for a node with no MAC', () => {
    const { container } = render(() => (
      <DeviceAliasSection
        node={{ id: 'owner:x', kind: 'owner', label: 'x', active: true }}
      />
    ));
    expect(container.textContent).toBe('');
  });
});

describe('DeviceSummaryRows', () => {
  it('rolls members up into counts, splits, and windows', () => {
    const { getByText } = render(() => (
      <DeviceSummaryRows
        devices={[
          device('aa:11', {
            owner_id: 'security',
            location_id: 'lab',
            registered: true,
            first_seen: '2026-09-01T00:00:00Z',
            last_seen: '2026-09-10T00:00:00Z',
          }),
          device('bb:22', {
            owner_id: 'security',
            location_id: 'lab',
            first_seen: '2026-08-01T00:00:00Z',
            last_seen: '2026-09-12T00:00:00Z',
          }),
        ]}
      />
    ));
    expect(getByText('Derived devices')).toBeTruthy();
    expect(getByText('1 registered, 1 unknown')).toBeTruthy();
    expect(getByText('security (2)')).toBeTruthy();
    expect(getByText('lab (2)')).toBeTruthy();
  });
});

describe('DerivedDeviceList', () => {
  const owner: InventoryNode = {
    id: 'owner:security',
    kind: 'owner',
    label: 'security',
    owner_id: 'security',
    active: true,
  };
  const nodes = [owner, device('aa:11'), device('bb:22')];
  const edges = [
    { id: 'o1', source: 'owner:security', target: 'device:aa:11', kind: 'owns' as const },
    { id: 'o2', source: 'owner:security', target: 'device:bb:22', kind: 'owns' as const },
  ];
  const index = buildInventoryRelationIndex(nodes, edges);

  it('lists the derived devices for an owner', () => {
    const { getByText, container } = render(() => (
      <DerivedDeviceList
        kind="owner"
        title="Owned devices (2 devices)"
        devices={relatedDevices(index, 'owner:security')}
        edgesLoaded={index.edgesLoaded}
      />
    ));
    expect(getByText('Show 2 derived devices')).toBeTruthy();
    expect(container.textContent).toContain('aa:11');
    expect(container.textContent).toContain('bb:22');
  });

  it('reports unavailable rather than empty when the report carried no edges', () => {
    const { getByText, queryByText } = render(() => (
      <DerivedDeviceList
        kind="owner"
        title="Owned devices (0 devices)"
        devices={[]}
        edgesLoaded={false}
      />
    ));
    expect(getByText(DERIVED_DEVICES_UNAVAILABLE)).toBeTruthy();
    expect(queryByText(/No related devices in the loaded projection/)).toBeNull();
  });

  it('distinguishes no members from unavailable relationships', () => {
    const { getByText } = render(() => (
      <DerivedDeviceList
        kind="owner"
        title="Owned devices (0 devices)"
        devices={[]}
        edgesLoaded
      />
    ));
    expect(
      getByText(/No related devices in the loaded projection/),
    ).toBeTruthy();
  });
});

describe('CollapsibleNodeList', () => {
  it('caps the rendered member rows and states the truncation', () => {
    const devices = manyDevices(DERIVED_DEVICE_PREVIEW_LIMIT + 7);
    const { getByText, queryByText } = render(() => (
      <CollapsibleNodeList
        items={devices.map((node) => ({
          key: node.id,
          primary: node.mac ?? node.id,
          secondary: node.registered ? 'Registered' : 'Unknown',
          body: <DeviceDetailRows node={node} />,
        }))}
      />
    ));
    expect(
      getByText(
        `Showing ${DERIVED_DEVICE_PREVIEW_LIMIT} of ${devices.length} derived devices. Narrow the filters to review the rest.`,
      ),
    ).toBeTruthy();
    // The row past the cap is counted but not rendered.
    expect(queryByText(`mac:${String(devices.length - 1).padStart(2, '0')}`)).toBeNull();
  });

  it('omits the truncation note when every member fits', () => {
    const { queryByText } = render(() => (
      <CollapsibleNodeList
        items={manyDevices(3).map((node) => ({
          key: node.id,
          primary: node.mac ?? node.id,
          secondary: 'Unknown',
          body: <DeviceDetailRows node={node} />,
        }))}
      />
    ));
    expect(queryByText(/Narrow the filters/)).toBeNull();
  });

  it('uses the supplied label for the member noun', () => {
    const { getByText } = render(() => (
      <CollapsibleNodeList
        label="identifiers"
        items={manyDevices(2).map((node) => ({
          key: node.id,
          primary: node.mac ?? node.id,
          secondary: 'Unknown',
          body: <DeviceDetailRows node={node} />,
        }))}
      />
    ));
    expect(getByText('Show 2 derived identifiers')).toBeTruthy();
  });
});

describe('derivedMacs', () => {
  it('collects and dedupes every identifier behind a node', () => {
    expect(
      derivedMacs([
        device('aa:11', { known_macs: ['aa:11', 'aa:11:alt'] }),
        device('aa:11'),
        device('bb:22'),
      ]),
    ).toEqual(['aa:11', 'aa:11:alt', 'bb:22']);
  });
});
