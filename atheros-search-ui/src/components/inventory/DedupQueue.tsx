import { createMemo, createSignal, For, Show } from 'solid-js';
import { Check, Clock3, Split } from 'lucide-solid';
import type { InventoryNode, MergeDecision } from '~/api/types';
import { ScoreBar } from '~/components/ScoreBar';
import {
  inventoryEdges,
  inventoryFilters,
  inventoryNodes,
} from '~/stores/inventoryStore';

interface QueueItem {
  candidate: InventoryNode;
  devices: InventoryNode[];
}

function confidenceResult(confidence: number) {
  return {
    score: confidence,
    cosine_similarity: confidence,
    keyword_rank: 0,
    threat_boost: 0,
  };
}

function candidateDevices(
  candidate: InventoryNode,
  nodes: Map<string, InventoryNode>,
) {
  return inventoryEdges()
    .filter(
      (edge) =>
        edge.kind === 'merge_candidate' &&
        (edge.source === candidate.id || edge.target === candidate.id),
    )
    .map((edge) =>
      nodes.get(edge.source === candidate.id ? edge.target : edge.source),
    )
    .filter((node): node is InventoryNode => Boolean(node));
}

function deviceLabels(devices: InventoryNode[]): string {
  return devices.map((device) => device.label).join(' / ');
}

export function DedupQueue(props: {
  onSelect: (candidateId: string) => void;
  onDecision: (
    candidateId: string,
    decision: MergeDecision,
  ) => void | Promise<void>;
}) {
  const [busyCandidateId, setBusyCandidateId] = createSignal<string | null>(
    null,
  );
  const queueItems = createMemo<QueueItem[]>(() => {
    const nodes = new Map(inventoryNodes().map((node) => [node.id, node]));
    const minConfidence = inventoryFilters.min_dedup_confidence ?? 0;
    return inventoryNodes()
      .filter(
        (node) =>
          node.kind === 'merge_candidate' &&
          (node.dedup_confidence ?? 0) >= minConfidence,
      )
      .map((candidate) => ({
        candidate,
        devices: candidateDevices(candidate, nodes),
      }))
      .sort(
        (left, right) =>
          (right.candidate.dedup_confidence ?? 0) -
          (left.candidate.dedup_confidence ?? 0),
      );
  });

  async function decide(candidateId: string, decision: MergeDecision) {
    setBusyCandidateId(candidateId);
    try {
      await props.onDecision(candidateId, decision);
    } finally {
      setBusyCandidateId(null);
    }
  }

  return (
    <section
      class="dedup-queue"
      aria-labelledby="dedup-queue-title"
      tabIndex={-1}
    >
      <div class="dedup-queue-heading">
        <h2 id="dedup-queue-title" class="heading-2">
          Dedup queue
        </h2>
        <span class="graph-stat">
          <strong>{queueItems().length}</strong> candidates
        </span>
      </div>

      <Show
        when={queueItems().length > 0}
        fallback={
          <div class="inventory-empty" role="status">
            No merge candidates match the current confidence threshold.
          </div>
        }
      >
        <div
          class="dedup-queue-table"
          role="table"
          aria-label="Merge candidates"
        >
          <div class="dedup-queue-row dedup-queue-row--head" role="row">
            <span role="columnheader">Candidate</span>
            <span role="columnheader">Identities</span>
            <span role="columnheader">Confidence</span>
            <span role="columnheader">Actions</span>
          </div>
          <For each={queueItems()}>
            {(item) => (
              <div class="dedup-queue-row" role="row">
                <button
                  type="button"
                  class="dedup-candidate-link"
                  onClick={() => props.onSelect(item.candidate.id)}
                >
                  {item.candidate.label}
                </button>
                <span class="dedup-identity-list" role="cell">
                  {deviceLabels(item.devices)}
                </span>
                <div role="cell">
                  <ScoreBar
                    variant="single"
                    label={`Dedup confidence ${(
                      (item.candidate.dedup_confidence ?? 0) * 100
                    ).toFixed(1)}%`}
                    result={confidenceResult(
                      item.candidate.dedup_confidence ?? 0,
                    )}
                  />
                </div>
                <div class="dedup-row-actions" role="cell">
                  <button
                    type="button"
                    class="icon-btn"
                    aria-label={`Merge ${item.candidate.label}`}
                    disabled={busyCandidateId() === item.candidate.id}
                    onClick={() => void decide(item.candidate.id, 'merge')}
                  >
                    <Check size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    class="icon-btn"
                    aria-label={`Mark ${item.candidate.label} as not a match`}
                    disabled={busyCandidateId() === item.candidate.id}
                    onClick={() => void decide(item.candidate.id, 'not_match')}
                  >
                    <Split size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    class="icon-btn"
                    aria-label={`Defer ${item.candidate.label}`}
                    disabled={busyCandidateId() === item.candidate.id}
                    onClick={() =>
                      void decide(item.candidate.id, 'needs_more_data')
                    }
                  >
                    <Clock3 size={16} aria-hidden="true" />
                  </button>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </section>
  );
}
