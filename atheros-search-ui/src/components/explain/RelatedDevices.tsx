import { A } from '@solidjs/router';
import { For, Show } from 'solid-js';
import type { Communication, Neighbour, RelatedContext } from '~/api/types';
import { formatDate } from '~/components/graph/graphPanelUtils';

const RELATIONSHIP_LABELS: Record<string, string> = {
  observed_ap_context: 'Seen at AP',
  association_frame_evidence: 'Association frames',
  confirmed_identity: 'Confirmed same device',
  inferred_rf_similarity: 'RF proximity',
};

const BASIS_LABELS: Record<string, string> = {
  frame_count: 'frame count',
  cluster_confidence: 'cluster confidence',
  time_overlap_windows: 'overlapping windows',
  channel_overlap: 'channel overlap',
  vendor_match: 'vendor match',
  operator_confirmation: 'operator confirmation',
};

const NEIGHBOUR_PREVIEW = 25;

function nodeLabel(id: string): string {
  return id.replace(/^(device|ap):/, '');
}

/**
 * Devices observed alongside the record's anchor, and the relationships the
 * projection derived. Overlap counts are evidence, never identity claims: a
 * corroborated row means two or more sensors saw the pair in the same window.
 */
export function RelatedDevices(props: {
  related: RelatedContext | null;
  unavailableReason?: string | undefined;
  graphHref: (mac: string) => string;
}) {
  const neighbours = () => props.related?.neighbours ?? [];
  const links = () => props.related?.links ?? [];
  const visible = () => neighbours().slice(0, NEIGHBOUR_PREVIEW);
  const capped = () => neighbours().length - visible().length;

  return (
    <>
      <Show
        when={props.related}
        fallback={
          <p class="graph-panel-empty" role="status">
            {props.unavailableReason ??
              'No neighbourhood is available for this record.'}
          </p>
        }
      >
        {(related) => (
          <>
            <p class="caption">
              Anchor: {related().anchor_kind} {related().anchor_id}. RF
              proximity is {related().rf_proximity}. {related().confidence}.
            </p>
            <Show when={related().focus_reason}>
              <p class="caption">{related().focus_reason}</p>
            </Show>

            <h3 class="heading-2">Related devices</h3>
            <Show
              when={neighbours().length > 0}
              fallback={
                <p class="graph-panel-empty" role="status">
                  No other identifier shared a retained sensor window with this
                  anchor in this window. That is not evidence that none was
                  present.
                </p>
              }
            >
              <div class="graph-detail-list">
                <For each={visible()}>
                  {(peer: Neighbour) => (
                    <div class="graph-detail-row">
                      <dt>
                        <A
                          href={props.graphHref(peer.mac)}
                          class="mono"
                          target="_blank"
                          rel="noreferrer"
                        >
                          {peer.label === peer.mac ? peer.mac : `${peer.label} (${peer.mac})`}
                        </A>
                      </dt>
                      <dd>
                        <span>
                          {peer.window_count} overlapping window
                          {peer.window_count === 1 ? '' : 's'}
                        </span>
                        <span>
                          across {peer.sensor_count} sensor
                          {peer.sensor_count === 1 ? '' : 's'}
                        </span>
                        <span>{peer.frame_count} frames</span>
                        <span>
                          {peer.ap_count} AP{peer.ap_count === 1 ? '' : 's'}
                        </span>
                        <span>
                          last seen {formatDate(peer.last_observed_at)}
                        </span>
                        <Show when={peer.rssi_avg_dbm !== undefined}>
                          <span>
                            RSSI {Math.round(peer.rssi_avg_dbm ?? 0)} dBm
                          </span>
                        </Show>
                        <span
                          class={
                            peer.corroborated
                              ? 'explain-corroborated'
                              : 'explain-uncorroborated'
                          }
                        >
                          {peer.corroborated
                            ? 'corroborated by multiple sensors'
                            : 'single-sensor overlap only'}
                        </span>
                      </dd>
                    </div>
                  )}
                </For>
              </div>
              <Show when={capped() > 0}>
                <p class="graph-panel-empty">
                  Showing {NEIGHBOUR_PREVIEW} of {neighbours().length} related
                  devices. Narrow the window to review the rest.
                </p>
              </Show>
            </Show>

            <h3 class="heading-2">Communications</h3>
            <Show
              when={links().length > 0}
              fallback={
                <p class="graph-panel-empty" role="status">
                  No relationship edges were derived for this anchor in this
                  window.
                </p>
              }
            >
              <div class="graph-detail-list">
                <For each={links()}>
                  {(link: Communication) => (
                    <div class="graph-detail-row">
                      <dt>
                        {RELATIONSHIP_LABELS[link.type] ?? link.type}
                      </dt>
                      <dd>
                        <span class="mono">
                          {nodeLabel(link.from)} to {nodeLabel(link.to)}
                        </span>
                        <Show when={link.weight !== undefined}>
                          <span>
                            weight {link.weight}{' '}
                            {link.weight_basis
                              ? BASIS_LABELS[link.weight_basis] ??
                                link.weight_basis
                              : ''}
                          </span>
                        </Show>
                        <Show when={link.confidence}>
                          <span>{link.confidence}</span>
                        </Show>
                        <Show when={!link.fresh}>
                          <span>not seen in the last 24h</span>
                        </Show>
                      </dd>
                    </div>
                  )}
                </For>
              </div>
            </Show>
            <p class="caption">{related().signal_quality}</p>
          </>
        )}
      </Show>
    </>
  );
}
