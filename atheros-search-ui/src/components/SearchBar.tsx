import { createMemo, createSignal, For, Show } from 'solid-js';
import { Search, X } from 'lucide-solid';
import { history, query, setQuery } from '~/stores/searchStore';

export function SearchBar(props: { onSubmit: () => void }) {
  const [open, setOpen] = createSignal(false);
  const [activeIndex, setActiveIndex] = createSignal(-1);

  const suggestions = createMemo(() =>
    history()
      .filter((item) => item.toLowerCase().includes(query().toLowerCase()))
      .slice(0, 8),
  );

  function submit() {
    setOpen(false);
    setActiveIndex(-1);
    props.onSubmit();
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const wasOpen = open();
      const count = suggestions().length;
      setOpen(true);
      if (count > 0) {
        setActiveIndex((index) =>
          wasOpen ? Math.min(index + 1, count - 1) : 0,
        );
      }
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      const wasOpen = open();
      const count = suggestions().length;
      setOpen(true);
      if (count > 0) {
        setActiveIndex((index) =>
          wasOpen && index >= 0 ? Math.max(index - 1, 0) : count - 1,
        );
      }
    }
    if (event.key === 'Enter') {
      if (activeIndex() >= 0) {
        const selected = suggestions()[activeIndex()];
        if (selected) setQuery(selected);
      }
      submit();
    }
    if (event.key === 'Escape') {
      setOpen(false);
      setActiveIndex(-1);
    }
  }

  return (
    <div class="search-bar-wrap" role="search">
      <label for="search-input" class="sr-only">
        Search wireless events
      </label>
      <Search class="search-icon" size={18} aria-hidden="true" />
      <input
        id="search-input"
        type="search"
        role="combobox"
        aria-expanded={open()}
        aria-controls={
          open() && suggestions().length > 0 ? 'search-listbox' : undefined
        }
        aria-activedescendant={
          activeIndex() >= 0 ? `suggestion-${activeIndex()}` : undefined
        }
        aria-autocomplete="list"
        autocomplete="off"
        spellcheck={false}
        value={query()}
        onInput={(event) => {
          setQuery(event.currentTarget.value);
          setOpen(true);
          setActiveIndex(-1);
        }}
        onKeyDown={handleKeyDown}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        placeholder="search events, devices, sequences"
      />
      <Show when={query()}>
        <button
          type="button"
          class="icon-btn search-clear"
          aria-label="Clear search"
          title="Clear search"
          onClick={() => {
            setQuery('');
            document.getElementById('search-input')?.focus();
          }}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </Show>
      <Show when={open() && suggestions().length > 0}>
        <ul
          id="search-listbox"
          role="listbox"
          aria-label="Search suggestions"
          class="suggestions-list"
        >
          <For each={suggestions()}>
            {(suggestion, index) => (
              <li
                id={`suggestion-${index()}`}
                role="option"
                aria-selected={activeIndex() === index()}
                onMouseDown={(event) => {
                  event.preventDefault();
                  setQuery(suggestion);
                  submit();
                }}
              >
                {suggestion}
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}
