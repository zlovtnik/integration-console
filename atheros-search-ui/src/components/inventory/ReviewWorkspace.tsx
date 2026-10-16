import { createEffect, onCleanup, Show } from 'solid-js';
import { useInventory } from '~/hooks/useInventory';
import { useInventoryUrlSync } from '~/hooks/useInventoryUrlSync';
import {
  inventoryDecisionNotice,
  inventoryFilters,
} from '~/stores/inventoryStore';
import { InventoryControls } from './InventoryControls';
import { DedupReview } from './DedupReview';

export function ReviewWorkspace(props: { revision: number }) {
  const { ready } = useInventoryUrlSync(true);
  const { loadDedupQueue, cancelDedupQueue, decideMerge } = useInventory();
  createEffect(() => {
    props.revision;
    JSON.stringify(inventoryFilters);
    if (!ready()) return;
    const timer = window.setTimeout(() => void loadDedupQueue(), 150);
    onCleanup(() => window.clearTimeout(timer));
  });
  onCleanup(cancelDedupQueue);
  return (
    <section aria-label="Candidate review">
      <InventoryControls
        reviewOnly
        onRefresh={() => void loadDedupQueue()}
        onResetView={() => undefined}
      />
      <Show when={inventoryDecisionNotice()}>
        <p role="status">{inventoryDecisionNotice()}</p>
      </Show>
      <DedupReview embedded onDecision={decideMerge} />
    </section>
  );
}
