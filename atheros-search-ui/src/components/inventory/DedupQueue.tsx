import { createMemo, createSignal, For, Show } from 'solid-js';
import { AlertTriangle, Check, Clock3, Split } from 'lucide-solid';
import type { InventoryNode, MergeDecision } from '~/api/types';
import { ScoreBar } from '~/components/ScoreBar';
import {
  inventoryDedupCandidates,
  inventoryDedupDevices,
  inventoryDedupEdges,
  inventoryDedupError,
  inventoryDecisionError,
  inventoryDedupLoading,
  inventoryDedupMeta,
  inventoryFilters,
} from '~/stores/inventoryStore';
import {
  DeviceSummaryLine,
  registrationLabel,
} from '~/components/graph/NodeDetailSections';
import {
  buildInventoryRelationIndex,
  derivedDevicesTitle,
  deviceAliasMacs,
  relatedDevices,
} from '~/utils/inventoryRelations';

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

/**
 * The queue loads candidates, their edges, and the referenced devices into
 * their own store so graph sampling cannot hide an identity. It is indexed
 * with the same derivation the panels use.
 */
function dedupRelationIndex() {
  return buildInventoryRelationIndex(
    inventoryDedupDevices(),
    inventoryDedupEdges(),
  );
}

export function DedupQueue(props: {
  onSelect: (candidateId: string) => void;
  onDecision: (
    candidateId: string,
    decision: MergeDecision,
  ) => void | Promise<void>;
}) {
  const [busyCandidateIds, setBusyCandidateIds] = createSignal<Set<string>>(
    new Set(),
  );
  const queueItems = createMemo<QueueItem[]>(() => {
    const index = dedupRelationIndex();
    const minConfidence = inventoryFilters.min_dedup_confidence ?? 0;
    return inventoryDedupCandidates()
      .filter((node) => (node.dedup_confidence ?? 0) >= minConfidence)
      .map((candidate) => ({
        candidate,
        devices: relatedDevices(index, candidate.id),
      }))
      .sort(
        (left, right) =>
          (right.candidate.dedup_confidence ?? 0) -
          (left.candidate.dedup_confidence ?? 0),
      );
  });

  async function decide(candidateId: string, decision: MergeDecision) {
    setBusyCandidateIds((prev) => new Set(prev).add(candidateId));
    try {
      await props.onDecision(candidateId, decision);
    } finally {
      setBusyCandidateIds((prev) => {
        const next = new Set(prev);
        next.delete(candidateId);
        return next;
      });
    }
  }

  const isCandidateBusy = (candidateId: string) =>
    busyCandidateIds().has(candidateId);

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
        <span class="graph-stat" aria-live="polite">
          <strong>{queueItems().length}</strong> candidates
          <Show when={inventoryDedupLoading()}>
            <span role="status">Loading candidates...</span>
          </Show>
          <Show when={!inventoryDedupLoading() && !inventoryDedupMeta.complete}>
            <span role="status">
              {inventoryDedupMeta.total_candidates} loaded so far
            </span>
          </Show>
        </span>
      </div>

      <Show when={inventoryDedupError()}>
        <div class="inventory-error" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>{inventoryDedupError()}</span>
        </div>
      </Show>
      <Show when={inventoryDecisionError()}>
        <p role="alert">
          {inventoryDecisionError()} Retry the decision using the same action.
          Evidence is retained.
        </p>
      </Show>

      <Show
        when={queueItems().length > 0}
        fallback={
          <Show
            when={!inventoryDedupLoading() && !inventoryDedupError()}
            fallback={<div aria-hidden="true" />}
          >
            <div class="inventory-empty" role="status">
              No merge candidates match the current confidence threshold.
            </div>
          </Show>
        }
      >
        <div
          class="dedup-queue-table"
          role="table"
          aria-label="Merge candidates"
        >
          <div class="dedup-queue-row dedup-queue-row--head" role="row">
            <span role="columnheader">Candidate</span>
            <span role="columnheader">Candidate devices</span>
            <span role="columnheader">Confidence</span>
            <span role="columnheader">Actions</span>
          </div>
          <For each={queueItems()}>
            {(item) => (
              <div class="dedup-queue-row" role="row">
                <div class="dedup-candidate-cell" role="cell">
                  <button
                    type="button"
                    class="dedup-candidate-link"
                    onClick={() => props.onSelect(item.candidate.id)}
                  >
                    {item.candidate.label}
                  </button>
                </div>
                <span class="dedup-identity-list" role="cell">
                  <Show
                    when={item.devices.length > 0}
                    fallback={
                      inventoryDedupLoading()
                        ? 'Loading identities...'
                        : 'Unresolved identities'
                    }
                  >
                    <span class="dedup-identity-join">
                      {derivedDevicesTitle('merge_candidate', item.devices.length)}
                    </span>
                    <For each={item.devices}>
                      {(device) => (
                        <span class="dedup-identity-entry">
                          <span>
                            {deviceAliasMacs(device).join(', ') || device.label}
                          </span>
                          <span>{registrationLabel(device)}</span>
                          <DeviceSummaryLine node={device} />
                        </span>
                      )}
                    </For>
                  </Show>
                </span>
                <div role="cell">
                  <ScoreBar
                    variant="single"
                    label="Candidate score (0 to 1)"
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
                    disabled={isCandidateBusy(item.candidate.id)}
                    onClick={() => void decide(item.candidate.id, 'merge')}
                  >
                    <Check size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    class="icon-btn"
                    aria-label={`Mark ${item.candidate.label} as not a match`}
                    disabled={isCandidateBusy(item.candidate.id)}
                    onClick={() => void decide(item.candidate.id, 'not_match')}
                  >
                    <Split size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    class="icon-btn"
                    aria-label={`Record needs more data for ${item.candidate.label}`}
                    disabled={isCandidateBusy(item.candidate.id)}
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
