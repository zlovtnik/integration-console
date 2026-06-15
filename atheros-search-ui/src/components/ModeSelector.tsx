import { For } from 'solid-js';
import type { SearchMode } from '~/api/types';
import { mode, setMode } from '~/stores/searchStore';

const MODES: { value: SearchMode; label: string; title: string }[] = [
  {
    value: 'SEARCH_MODE_DENSE',
    label: 'Semantic',
    title: 'Vector similarity - finds conceptually related results',
  },
  {
    value: 'SEARCH_MODE_SPARSE',
    label: 'Keyword',
    title: 'Exact term matching - best for MAC addresses or IDs',
  },
  {
    value: 'SEARCH_MODE_HYBRID',
    label: 'Hybrid',
    title: 'Combines semantic and keyword search',
  },
];

export function ModeSelector() {
  return (
    <fieldset
      class="segmented-control"
      role="radiogroup"
      aria-label="Search mode"
    >
      <legend class="sr-only">Search mode</legend>
      <For each={MODES}>
        {(option) => (
          <label class="seg-option" title={option.title}>
            <input
              type="radio"
              name="mode"
              value={option.value}
              checked={mode() === option.value}
              onChange={() => setMode(option.value)}
            />
            <span>{option.label}</span>
          </label>
        )}
      </For>
    </fieldset>
  );
}
