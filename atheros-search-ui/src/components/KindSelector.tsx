import { For } from 'solid-js';
import type { SearchKind } from '~/api/types';
import { kind, setKind } from '~/stores/searchStore';

const KINDS: { value: SearchKind; label: string }[] = [
  { value: 'SEARCH_KIND_EVENT', label: 'event' },
  { value: 'SEARCH_KIND_BEHAVIOUR', label: 'behaviour' },
  { value: 'SEARCH_KIND_SEQUENCE', label: 'sequence' },
  { value: 'SEARCH_KIND_DEVICE', label: 'device' },
  { value: 'SEARCH_KIND_CROSS', label: 'cross' },
];

export function KindSelector() {
  return (
    <fieldset class="segmented-control" role="radiogroup" aria-label="Search kind">
      <legend class="sr-only">Search kind</legend>
      <For each={KINDS}>
        {(option) => (
          <label class="seg-option">
            <input
              type="radio"
              name="kind"
              value={option.value}
              checked={kind() === option.value}
              onChange={() => setKind(option.value)}
            />
            <span>{option.label}</span>
          </label>
        )}
      </For>
    </fieldset>
  );
}
