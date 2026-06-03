import { onCleanup, onMount } from 'solid-js';

type ShortcutHandlers = Partial<Record<
  | 'focusSearch'
  | 'escape'
  | 'submitSearch'
  | 'toggleFilters'
  | 'nextResult'
  | 'prevResult'
  | 'openFocusedResult'
  | 'showHelp',
  () => void
>>;

export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
  function handleKeyDown(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName ?? '';
    const inInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag);
    const command = event.metaKey || event.ctrlKey;

    if (event.key === '/' && !inInput) {
      event.preventDefault();
      handlers.focusSearch?.();
    }
    if (command && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      handlers.focusSearch?.();
    }
    if (command && event.key === 'Enter') {
      event.preventDefault();
      handlers.submitSearch?.();
    }
    if (command && event.shiftKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      handlers.toggleFilters?.();
    }
    if (event.key === 'Escape') handlers.escape?.();
    if (!inInput && event.key.toLowerCase() === 'j') {
      event.preventDefault();
      handlers.nextResult?.();
    }
    if (!inInput && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      handlers.prevResult?.();
    }
    if (!inInput && event.key === 'Enter') handlers.openFocusedResult?.();
    if (!inInput && event.key === '?') {
      event.preventDefault();
      handlers.showHelp?.();
    }
  }

  onMount(() => window.addEventListener('keydown', handleKeyDown));
  onCleanup(() => window.removeEventListener('keydown', handleKeyDown));
}
