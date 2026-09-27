import { createResource, createSignal, For, Show, onCleanup } from 'solid-js';
import { Check, Clock3, Split, X } from 'lucide-solid';
import type { InventoryNode, MergeDecision } from '~/api/types';
import { ScoreBar } from '~/components/ScoreBar';
import { DetailRow } from '~/components/graph/graphPanelUtils';
import { api } from '~/api/client';
import { stripMergeNodePrefix } from '~/hooks/useInventory';
import { JsonViewer } from '~/components/JsonViewer';

function confidenceResult(confidence: number) {
  return {
    score: confidence,
    cosine_similarity: confidence,
    keyword_rank: 0,
    threat_boost: 0,
  };
}

function macs(node: InventoryNode): string[] {
  return node.known_macs?.length ? node.known_macs : node.mac ? [node.mac] : [];
}

function CandidateIdentity(props: { node: InventoryNode }) {
  return (
    <article class="inventory-candidate-card">
      <h3>{props.node.label}</h3>
      <dl class="graph-detail-list">
        <DetailRow label="Display name" value={props.node.display_name} />
        <DetailRow label="Owner" value={props.node.owner_id} />
        <DetailRow label="Location" value={props.node.location_id} />
        <DetailRow label="Last seen" value={props.node.last_seen} date />
      </dl>
      <Show when={macs(props.node).length > 0}>
        <ul class="inventory-mac-list">
          <For each={macs(props.node)}>{(mac) => <li>{mac}</li>}</For>
        </ul>
      </Show>
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
