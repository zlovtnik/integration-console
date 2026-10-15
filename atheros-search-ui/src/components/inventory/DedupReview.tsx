import { Show } from 'solid-js';
import type { MergeDecision } from '~/api/types';
import { DedupQueue } from './DedupQueue';
import { MergeCandidatePanel } from './MergeCandidatePanel';
import {
  inventoryDedupCandidates,
  selectedInventoryNodeId,
  setSelectedInventoryNodeId,
} from '~/stores/inventoryStore';

export function DedupReview(props: {
  onDecision: (id: string, decision: MergeDecision) => Promise<boolean | void>;
  embedded?: boolean;
}) {
  const selected = () =>
    inventoryDedupCandidates().find(
      (node) => node.id === selectedInventoryNodeId(),
    );
  return (
    <>
      <DedupQueue
        onSelect={setSelectedInventoryNodeId}
        onDecision={props.onDecision}
        embedded={!!props.embedded}
      />
      <Show when={selected()}>
        {(node) => (
          <MergeCandidatePanel
            node={node()}
            onClose={() => setSelectedInventoryNodeId(null)}
            onDecision={(decision) => props.onDecision(node().id, decision)}
          />
        )}
      </Show>
    </>
  );
}
