import { For } from 'solid-js';
import type { SearchKind } from '~/api/types';
import { kind, setKind } from '~/stores/searchStore';

const KINDS: { value: SearchKind; label: string; title: string }[] = [
  {
    value: 'SEARCH_KIND_EVENT',
    label: 'Event',
    title: 'Single wireless frame events such as probe requests or deauths',
  },
  {
    value: 'SEARCH_KIND_BEHAVIOUR',
    label: 'Behaviour',
    title: 'Patterns of activity across multiple frames',
  },
  {
    value: 'SEARCH_KIND_SEQUENCE',
    label: 'Sequence',
    title: 'Ordered event chains from a device',
  },
  {
    value: 'SEARCH_KIND_DEVICE',
    label: 'Device',
    title: 'Per-device profiles and identity',
  },
  {
    value: 'SEARCH_KIND_CROSS',
    label: 'Cross',
    title: 'Search across all types simultaneously',
  },
];

export function KindSelector() {
  return (
    <fieldset
      class="segmented-control"
      role="radiogroup"
      aria-label="Search kind"
    >
      <legend class="sr-only">Search kind</legend>
      <For each={KINDS}>
        {(option) => (
          <label class="seg-option" title={option.title}>
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
