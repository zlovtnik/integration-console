import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Show,
  on,
  onCleanup,
} from 'solid-js';
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
  ) => void | boolean | Promise<void | boolean>;
}) {
  const [query, setQuery] = createSignal('');
  const [selectedIds, setSelectedIds] = createSignal(new Set<string>());
  const [reviewing, setReviewing] = createSignal(false);
  const [batchBusy, setBatchBusy] = createSignal(false);
  const [batchNotice, setBatchNotice] = createSignal('');
  let active = true;
  onCleanup(() => {
    active = false;
  });
  const scopeKey = () => JSON.stringify(inventoryFilters);
  createEffect(
    on(
      scopeKey,
      () => {
        setSelectedIds(new Set<string>());
        setReviewing(false);
      },
      { defer: true },
    ),
  );
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
      .filter((item) => {
        const search = query().trim().toLowerCase();
        return (
          !search ||
          [
            item.candidate.label,
            ...item.devices.flatMap((device) => [
              device.label,
              device.owner_id ?? '',
              ...deviceAliasMacs(device),
            ]),
          ].some((value) => value.toLowerCase().includes(search))
        );
      })
      .sort(
        (left, right) =>
          (right.candidate.dedup_confidence ?? 0) -
          (left.candidate.dedup_confidence ?? 0),
      );
  });
  const selectedItems = createMemo(() =>
    queueItems().filter((item) => selectedIds().has(item.candidate.id)),
  );
  const selectionLocked = () =>
    batchBusy() || busyCandidateIds().size > 0 || inventoryDedupLoading();
  function select(id: string, checked: boolean) {
    setReviewing(false);
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function approveSelected() {
    const items = [...selectedItems()];
    const scope = scopeKey();
    setBatchBusy(true);
    setReviewing(false);
    let approved = 0;
    let failed = 0;
    try {
      for (const item of items) {
        if (!active || scopeKey() !== scope) break;
        setBatchNotice(
          `Approving ${approved + failed + 1} of ${items.length} selected pairs...`,
        );
        try {
          const accepted = await props.onDecision(item.candidate.id, 'merge');
          if (accepted !== false) {
            approved += 1;
            select(item.candidate.id, false);
          } else failed += 1;
        } catch {
          failed += 1;
        }
      }
      const remaining = items.length - approved - failed;
      setBatchNotice(
        `${approved} approved, ${failed} failed${remaining ? `, ${remaining} not submitted because the review scope changed` : ''}.${failed && scopeKey() === scope ? ' Failed pairs remain selected for retry.' : ''} Identity projection updates are not yet confirmed.`,
      );
    } finally {
      setBatchBusy(false);
    }
  }

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
        when={inventoryDedupCandidates().length > 0}
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
        <div class="dedup-bulk-toolbar">
          <label class="field">
            <span>Find a device or owner</span>
            <input
              type="search"
              value={query()}
              disabled={batchBusy()}
              onInput={(event) => {
                setQuery(event.currentTarget.value);
                setReviewing(false);
                setSelectedIds(new Set<string>());
              }}
            />
          </label>
          <span aria-live="polite">
            {selectedItems().length} pairs selected
          </span>
          <button
            type="button"
            class="btn btn-primary"
            disabled={selectionLocked() || selectedItems().length === 0}
            onClick={() => setReviewing(true)}
          >
            Review selected approvals
          </button>
          <button
            type="button"
            class="btn btn-secondary"
            disabled={selectionLocked()}
            onClick={() => {
              setSelectedIds(new Set<string>());
              setReviewing(false);
            }}
          >
            Clear selection
          </button>
        </div>
        <Show when={reviewing()}>
          <section
            class="dedup-bulk-preview"
            aria-label="Selected approval preview"
          >
            <h3>Approve {selectedItems().length} identity pairs</h3>
            <p>
              Each selected pair will be recorded as a merge. Decisions are
              final. Review the devices below before approving.
            </p>
            <ul>
              <For each={selectedItems()}>
                {(item) => (
                  <li>
                    {item.candidate.label} -{' '}
                    {item.devices.map((device) => device.label).join(' / ')}
                  </li>
                )}
              </For>
            </ul>
            <button
              type="button"
              class="btn btn-primary"
              disabled={selectionLocked()}
              onClick={() => void approveSelected()}
            >
              Approve selected pairs
            </button>
            <button
              type="button"
              class="btn btn-secondary"
              onClick={() => setReviewing(false)}
            >
              Cancel
            </button>
          </section>
        </Show>
        <div
          class="dedup-queue-table"
          role="table"
          aria-label="Merge candidates"
        >
          <div class="dedup-queue-row dedup-queue-row--head" role="row">
            <span role="columnheader">
              <input
                type="checkbox"
                aria-label="Select all visible pairs"
                disabled={selectionLocked()}
                checked={
                  queueItems().length > 0 &&
                  selectedItems().length === queueItems().length
                }
                onChange={(event) => {
                  setReviewing(false);
                  setSelectedIds(
                    event.currentTarget.checked
                      ? new Set(queueItems().map((item) => item.candidate.id))
                      : new Set<string>(),
                  );
                }}
              />
            </span>
            <span role="columnheader">Candidate</span>
            <span role="columnheader">Candidate devices</span>
            <span role="columnheader">Confidence</span>
            <span role="columnheader">Actions</span>
          </div>
          <For each={queueItems()}>
            {(item) => (
              <div class="dedup-queue-row" role="row">
                <span role="cell">
                  <input
                    type="checkbox"
                    aria-label={`Select ${item.candidate.label}`}
                    checked={selectedIds().has(item.candidate.id)}
                    disabled={selectionLocked()}
                    onChange={(event) =>
                      select(item.candidate.id, event.currentTarget.checked)
                    }
                  />
                </span>
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
                      {derivedDevicesTitle(
                        'merge_candidate',
                        item.devices.length,
                      )}
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
                    disabled={batchBusy() || isCandidateBusy(item.candidate.id)}
                    onClick={() => void decide(item.candidate.id, 'merge')}
                  >
                    <Check size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    class="icon-btn"
                    aria-label={`Mark ${item.candidate.label} as not a match`}
                    disabled={batchBusy() || isCandidateBusy(item.candidate.id)}
                    onClick={() => void decide(item.candidate.id, 'not_match')}
                  >
                    <Split size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    class="icon-btn"
                    aria-label={`Record needs more data for ${item.candidate.label}`}
                    disabled={batchBusy() || isCandidateBusy(item.candidate.id)}
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
      <Show when={batchNotice()}>
        <p role="status">{batchNotice()}</p>
      </Show>
    </section>
  );
}
