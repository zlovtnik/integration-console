import { createEffect, For, on, onCleanup, onMount, Show } from 'solid-js';
import { X } from 'lucide-solid';

const isMac = () => navigator.platform.startsWith('Mac');
const mod = () => (isMac() ? 'Cmd' : 'Ctrl');

const SHORTCUTS = () =>
  [
    ['/', 'Focus search'],
    [`${mod()} K`, 'Focus search'],
    [`${mod()} Enter`, 'Submit search'],
    [`${mod()} Shift F`, 'Toggle filters'],
    ['J / K', 'Navigate results down / up'],
    ['Enter', 'Open focused result'],
    ['?', 'Show this panel'],
    ['Esc', 'Close / clear'],
  ] as const;

export function ShortcutsModal(props: { open: boolean; onClose: () => void }) {
  let dialogRef: HTMLDivElement | undefined;
  let lastFocused: HTMLElement | null = null;

  function restoreFocus() {
    const target = lastFocused;
    lastFocused = null;
    if (!target?.isConnected) return;

    queueMicrotask(() => target.focus());
  }

  createEffect(
    on(
      () => props.open,
      (open) => {
        if (open) {
          lastFocused = document.activeElement as HTMLElement | null;
          queueMicrotask(() =>
            dialogRef?.querySelector<HTMLElement>('button')?.focus(),
          );
        } else {
          restoreFocus();
        }
      },
    ),
  );

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') props.onClose();
    if (event.key !== 'Tab' || !dialogRef) return;

    const focusable = Array.from(
      dialogRef.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function handleGlobalKeyDown(event: KeyboardEvent) {
    if (!props.open) return;
    handleKeyDown(event);
  }

  onMount(() => window.addEventListener('keydown', handleGlobalKeyDown));
  onCleanup(() => {
    window.removeEventListener('keydown', handleGlobalKeyDown);
    restoreFocus();
  });

  return (
    <Show when={props.open}>
      <div class="modal-backdrop">
        <div
          ref={dialogRef}
          class="modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="shortcuts-title"
        >
          <div class="modal-header">
            <h2 id="shortcuts-title" class="heading-2">
              Commands
            </h2>
            <button
              type="button"
              class="icon-btn"
              aria-label="Close"
              onClick={() => props.onClose()}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
          <dl class="shortcut-list">
            <For each={SHORTCUTS()}>
              {([keys, action]) => (
                <div>
                  <dt class="mono">{keys}</dt>
                  <dd>{action}</dd>
                </div>
              )}
            </For>
          </dl>
        </div>
      </div>
    </Show>
  );
}
