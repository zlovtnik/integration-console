import { For, Show } from 'solid-js';
import { DetailRow } from '~/components/graph/graphPanelUtils';
import type { RecordFields } from '~/api/types';

/**
 * The stored document as a definition list. This is the first thing a record
 * page should answer: which identifier, where, when, and of what type.
 */
export function RecordSummary(props: { record: RecordFields }) {
  const record = () => props.record;
  const hasType = () =>
    Boolean(
      record().frame_subtype ||
        record().classification ||
        record().proxy_event_type ||
        record().host,
    );
  const blocked = () => {
    const value = record().blocked;
    return value === null || value === undefined ? undefined : value;
  };

  return (
    <div class="graph-detail-list">
      <Show when={record().title}>
        <DetailRow label="Title" value={record().title} />
      </Show>
      <DetailRow label="Source kind" value={record().source_kind} />
      <DetailRow label="Status" value={record().status} />
      <DetailRow label="Observed" value={record().observed_at} date />
      <Show when={record().window_start}>
        <DetailRow
          label="Window"
          value={`${record().window_start} to ${record().window_end ?? ''}`}
          date
        />
      </Show>
      <DetailRow label="Device MAC" value={record().source_mac} />
      <DetailRow label="AP BSSID" value={record().bssid} />
      <DetailRow label="SSID" value={record().ssid} />
      <DetailRow label="Location" value={record().location_id} />
      <DetailRow label="Sensor" value={record().sensor_id} />
      <Show when={hasType()}>
        <DetailRow label="Frame subtype" value={record().frame_subtype} />
        <DetailRow label="Classification" value={record().classification} />
        <DetailRow label="Host" value={record().host} />
        <DetailRow label="Proxy event" value={record().proxy_event_type} />
        <DetailRow label="Blocked" value={blocked()} />
      </Show>
      <DetailRow label="Handshake" value={record().handshake_captured} />
      <DetailRow label="Security flags" value={record().security_flags} />
      <Show when={record().tags.length > 0}>
        <div class="graph-detail-row">
          <dt>Tags</dt>
          <dd class="badge-row">
            <For each={record().tags}>
              {(tag) => <span class="kind-badge">{tag}</span>}
            </For>
          </dd>
        </div>
      </Show>
      <Show when={record().producer}>
        <DetailRow label="Producer" value={record().producer} />
      </Show>
      <Show when={record().document_id}>
        <DetailRow label="Document" value={record().document_id} />
      </Show>
    </div>
  );
}
