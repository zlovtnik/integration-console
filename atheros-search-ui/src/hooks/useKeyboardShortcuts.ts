import { onCleanup, onMount } from 'solid-js';

type ShortcutHandlers = Partial<
  Record<
    | 'focusSearch'
    | 'escape'
    | 'submitSearch'
    | 'toggleFilters'
    | 'nextResult'
    | 'prevResult'
    | 'openFocusedResult'
    | 'showHelp',
    () => void
  >
>;

export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
  function handleKeyDown(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName ?? '';
    const inInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag);
    const command = event.metaKey || event.ctrlKey;
    const noModifiers =
      !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
    const noCommandModifiers =
      !event.metaKey && !event.ctrlKey && !event.altKey;

    if (event.key === '/' && !inInput) {
      event.preventDefault();
      handlers.focusSearch?.();
    }
    if (command && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      handlers.focusSearch?.();
      return;
    }
    if (command && event.key === 'Enter') {
      event.preventDefault();
      handlers.submitSearch?.();
      return;
    }
    if (command && event.shiftKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      handlers.toggleFilters?.();
      return;
    }
    if (event.key === 'Escape') handlers.escape?.();
    if (!inInput && noModifiers && event.key.toLowerCase() === 'j') {
      event.preventDefault();
      handlers.nextResult?.();
    }
    if (!inInput && noModifiers && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      handlers.prevResult?.();
    }
    if (!inInput && noModifiers && event.key === 'Enter')
      handlers.openFocusedResult?.();
    if (!inInput && noCommandModifiers && event.key === '?') {
      event.preventDefault();
      handlers.showHelp?.();
    }
  }

  onMount(() => window.addEventListener('keydown', handleKeyDown));
  onCleanup(() => window.removeEventListener('keydown', handleKeyDown));
}
