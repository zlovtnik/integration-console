import { createMemo, createSignal, For, Show } from 'solid-js';
import { Check, Clock3, Split, X } from 'lucide-solid';
import type { InventoryNode, MergeDecision } from '~/api/types';
import { ScoreBar } from '~/components/ScoreBar';
import { DetailRow } from '~/components/graph/graphPanelUtils';
import { inventoryEdges, inventoryNodes } from '~/stores/inventoryStore';

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
  const nodesById = createMemo(() => {
    const next = new Map<string, InventoryNode>();
    for (const node of inventoryNodes()) next.set(node.id, node);
    return next;
  });
  const candidates = createMemo(() =>
    inventoryEdges()
      .filter(
        (edge) =>
          edge.kind === 'merge_candidate' &&
          (edge.source === props.node.id || edge.target === props.node.id),
      )
      .map((edge) =>
        nodesById().get(
          edge.source === props.node.id ? edge.target : edge.source,
        ),
      )
      .filter((node): node is InventoryNode => Boolean(node)),
  );
  const confidence = () => props.node.dedup_confidence ?? 0;

  async function decide(decision: MergeDecision) {
    setBusyDecision(decision);
    try {
      await props.onDecision(decision);
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
        <h3>Confidence</h3>
        <ScoreBar
          variant="single"
          label={`Dedup confidence ${(confidence() * 100).toFixed(1)}%`}
          result={confidenceResult(confidence())}
        />
      </section>

      <section class="graph-panel-section">
        <h3>Candidate identities</h3>
        <div class="inventory-candidate-grid">
          <For each={candidates()}>
            {(node) => <CandidateIdentity node={node} />}
          </For>
        </div>
      </section>

      <section class="graph-panel-section">
        <h3>Decision</h3>
        <div class="inventory-decision-actions">
          <button
            type="button"
            class="btn btn-primary"
            disabled={busyDecision() !== null}
            onClick={() => void decide('merge')}
          >
            <Check size={16} aria-hidden="true" />
            <span>{busyDecision() === 'merge' ? 'Merging' : 'Merge'}</span>
          </button>
          <button
            type="button"
            class="btn btn-secondary"
            disabled={busyDecision() !== null}
            onClick={() => void decide('not_match')}
          >
            <Split size={16} aria-hidden="true" />
            <span>Not a match</span>
          </button>
          <button
            type="button"
            class="btn btn-secondary"
            disabled={busyDecision() !== null}
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
