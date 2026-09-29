import { createMemo, createResource, createSignal, For, Show, onCleanup } from 'solid-js';
import { A } from '@solidjs/router';
import { Check, Clock3, Split, X } from 'lucide-solid';
import type { InventoryNode, MergeDecision } from '~/api/types';
import { ScoreBar } from '~/components/ScoreBar';
import {
  DeviceAliasSection,
  DeviceDetailRows,
  DeviceSummaryLine,
  DerivedDeviceList,
} from '~/components/graph/NodeDetailSections';
import { api } from '~/api/client';
import { stripMergeNodePrefix } from '~/hooks/useInventory';
import { JsonViewer } from '~/components/JsonViewer';
import {
  buildInventoryRelationIndex,
  deviceAliasMacs,
  relatedDevices,
} from '~/utils/inventoryRelations';
import {
  inventoryDedupDevices,
  inventoryDedupEdges,
  inventoryNodes,
  inventoryEdges,
} from '~/stores/inventoryStore';

function confidenceResult(confidence: number) {
  return {
    score: confidence,
    cosine_similarity: confidence,
    keyword_rank: 0,
    threat_boost: 0,
  };
}

/**
 * Renders one side of the pair through the shared joined detail so a merge
 * candidate reads identically to any other device in the report.
 */
function CandidateIdentity(props: { node: InventoryNode }) {
  return (
    <article class="inventory-candidate-card">
      <h3>{props.node.label}</h3>
      <DeviceSummaryLine node={props.node} />
      <DeviceDetailRows node={props.node} />
      <DeviceAliasSection node={props.node} />
    </article>
  );
}

export function MergeCandidatePanel(props: {
  node: InventoryNode;
  onClose: () => void;
  onDecision: (decision: MergeDecision) => void | Promise<void>;
}) {
  const [busyDecision, setBusyDecision] = createSignal<MergeDecision | null>(
    null,
  );
  let controller: AbortController | undefined;
  const [pairError, setPairError] = createSignal('');
  const [detail, { refetch }] = createResource(
    () => props.node.id,
    async (id) => {
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      setPairError('');
      try {
        return await api.pairDetail(stripMergeNodePrefix(id), signal);
      } catch {
        if (!signal.aborted) setPairError('Pair evidence unavailable.');
        return null;
      }
    },
  );
  onCleanup(() => controller?.abort());
  const candidates = () => (detail.loading ? [] : (detail()?.devices ?? []));
  const confidence = () =>
    detail()?.confidence ?? props.node.dedup_confidence ?? 0;

  /**
   * The pair's own devices come from the evidence endpoint so the panel is
   * correct with an empty graph. Any further devices the loaded projection
   * relates to this candidate are added from the edges, and the dedupe queue
   * store is folded in because it is loaded independently of the graph.
   */
  const index = createMemo(() => {
    const graph = buildInventoryRelationIndex(inventoryNodes(), inventoryEdges());
    const queue = buildInventoryRelationIndex(
      inventoryDedupDevices(),
      inventoryDedupEdges(),
    );
    return {
      edgesLoaded: graph.edgesLoaded || queue.edgesLoaded,
      devices: Array.from(
        new Map(
          [
            ...relatedDevices(queue, props.node.id),
            ...relatedDevices(graph, props.node.id),
          ].map((device) => [device.id, device]),
        ).values(),
      ),
    };
  });
  const candidateMacs = () => {
    const fromPair = candidates().flatMap((device) => deviceAliasMacs(device));
    const fromGraph = index().devices.flatMap((device) =>
      deviceAliasMacs(device),
    );
    return Array.from(new Set([...fromPair, ...fromGraph]));
  };

  const eventSearchHref = (macs: string[]): string => {
    const params = new URLSearchParams({
      q: '*',
      kind: 'SEARCH_KIND_EVENT',
      mode: 'SEARCH_MODE_SPARSE',
      k: '200',
    });
    for (const mac of macs.slice(0, 50)) params.append('mac', mac);
    for (const key of ['loc', 'sensor', 'after', 'before']) {
      for (const value of new URLSearchParams(
        window.location.search,
      ).getAll(key)) {
        params.append(key, value);
      }
    }
    return `/?${params.toString()}`;
  };

  async function decide(decision: MergeDecision) {
    setBusyDecision(decision);
    try {
      await props.onDecision(decision);
    } catch {
      // The parent retains the pair and displays the decision error.
    } finally {
      setBusyDecision(null);
    }
  }

  return (
    <aside
      class="graph-node-panel inventory-node-panel merge-candidate-panel"
      aria-labelledby="merge-candidate-panel-title"
      role="complementary"
    >
      <div class="graph-panel-heading">
        <div>
          <p class="caption">Merge candidate</p>
          <h2 id="merge-candidate-panel-title" class="heading-2">
            {props.node.label}
          </h2>
        </div>
        <button
          type="button"
          class="icon-btn"
          aria-label="Close merge candidate"
          onClick={() => props.onClose()}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      <section class="graph-panel-section">
        <h3>Candidate score</h3>
        <ScoreBar
          variant="single"
          label="Dedup candidate score (unitless, 0 to 1)"
          result={confidenceResult(confidence())}
        />
      </section>

      <section class="graph-panel-section">
        <h3>Candidate identities</h3>
        <Show when={detail.loading}>
          <p role="status">Loading pair evidence...</p>
        </Show>
        <Show when={pairError()}>
          <p role="alert">
            {pairError()}{' '}
            <button type="button" onClick={() => void refetch()}>
              Retry evidence
            </button>
          </p>
        </Show>
        <div class="inventory-candidate-grid">
          <For each={candidates()}>
            {(node) => <CandidateIdentity node={node} />}
          </For>
        </div>
      </section>

      <DerivedDeviceList
        kind="merge_candidate"
        title={`Candidate devices in the loaded projection (${index().devices.length})`}
        devices={index().devices}
        edgesLoaded={index().edgesLoaded}
        provenance="Derived from the identifiers and relationships loaded for the current filters. Pending similarity is not a confirmed identity match."
      />

      <section class="graph-panel-section">
        <h3>Actions</h3>
        <div class="graph-panel-links">
          <Show when={candidateMacs().length > 0}>
            <A class="btn btn-secondary" href={eventSearchHref(candidateMacs())}>
              Search events
            </A>
          </Show>
        </div>
      </section>

      <Show when={!detail.loading && detail()}>
        {(pair) => (
          <section class="graph-panel-section">
            <h3>Evidence and provenance</h3>
            <p>
              Pair: {pair().mac_a} / {pair().mac_b}. Registry details may be
              unavailable for either identifier.
            </p>
            <p>
              Evidence computed: {pair().computed_at}. Status: {pair().status}.
            </p>
            <p>
              Method/model and conflicts are shown only where provided in the
              evidence.
            </p>
            <JsonViewer json={JSON.stringify(pair().evidence)} />
            <p>Projection run: {pair().projection_run_id}</p>
            <Show when={pair().decision}>
              <p>
                Decision recorded: {pair().decision} by{' '}
                {pair().decided_by ?? 'Unknown'} at{' '}
                {pair().decided_at ?? 'Unknown'}. Identity projection update is
                not confirmed here.
              </p>
            </Show>
          </section>
        )}
      </Show>

      <section class="graph-panel-section">
        <h3>Decision</h3>
        <p>
          Every decision is final, including needs more data. Recording a
          decision does not confirm an identity projection update.
        </p>
        <div class="inventory-decision-actions">
          <button
            type="button"
            class="btn btn-primary"
            disabled={
              busyDecision() !== null ||
              detail.loading ||
              !!pairError() ||
              !detail() ||
              !!detail()?.decision
            }
            onClick={() => void decide('merge')}
          >
            <Check size={16} aria-hidden="true" />
            <span>{busyDecision() === 'merge' ? 'Merging' : 'Merge'}</span>
          </button>
          <button
            type="button"
            class="btn btn-secondary"
            disabled={
              busyDecision() !== null ||
              detail.loading ||
              !!pairError() ||
              !detail() ||
              !!detail()?.decision
            }
            onClick={() => void decide('not_match')}
          >
            <Split size={16} aria-hidden="true" />
            <span>Not a match</span>
          </button>
          <button
            type="button"
            class="btn btn-secondary"
            disabled={
              busyDecision() !== null ||
              detail.loading ||
              !!pairError() ||
              !detail() ||
              !!detail()?.decision
            }
            onClick={() => void decide('needs_more_data')}
          >
            <Clock3 size={16} aria-hidden="true" />
            <span>Needs more data</span>
          </button>
        </div>
      </section>
    </aside>
  );
}
