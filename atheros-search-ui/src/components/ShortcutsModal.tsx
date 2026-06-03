import { createEffect, For, onCleanup, onMount, Show } from 'solid-js';
import { X } from 'lucide-solid';

const SHORTCUTS = [
  ['/', 'Focus search'],
  ['Cmd/Ctrl K', 'Focus search'],
  ['Cmd/Ctrl Enter', 'Submit search'],
  ['Cmd/Ctrl Shift F', 'Toggle filters'],
  ['J / K', 'Move results'],
  ['Enter', 'Open focused result'],
  ['Escape', 'Close'],
] as const;

export function ShortcutsModal(props: { open: boolean; onClose: () => void }) {
  let dialogRef: HTMLDivElement | undefined;

  createEffect(() => {
    if (props.open) {
      queueMicrotask(() => dialogRef?.querySelector<HTMLElement>('button')?.focus());
    }
  });

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') props.onClose();
    if (event.key !== 'Tab' || !dialogRef) return;

    const focusable = Array.from(
      dialogRef.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
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
  onCleanup(() => window.removeEventListener('keydown', handleGlobalKeyDown));

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
            <button type="button" class="icon-btn" aria-label="Close" onClick={() => props.onClose()}>
              <X size={18} aria-hidden="true" />
            </button>
          </div>
          <dl class="shortcut-list">
            <For each={SHORTCUTS}>
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
