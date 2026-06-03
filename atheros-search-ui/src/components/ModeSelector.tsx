import { For } from 'solid-js';
import type { SearchMode } from '~/api/types';
import { mode, setMode } from '~/stores/searchStore';

const MODES: { value: SearchMode; label: string }[] = [
  { value: 'SEARCH_MODE_DENSE', label: 'dense' },
  { value: 'SEARCH_MODE_SPARSE', label: 'sparse' },
  { value: 'SEARCH_MODE_HYBRID', label: 'hybrid' },
];

export function ModeSelector() {
  return (
    <fieldset class="segmented-control" role="radiogroup" aria-label="Search mode">
      <legend class="sr-only">Search mode</legend>
      <For each={MODES}>
        {(option) => (
          <label class="seg-option">
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
