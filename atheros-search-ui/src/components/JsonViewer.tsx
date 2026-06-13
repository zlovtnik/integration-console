import { createMemo, createSignal, onCleanup } from 'solid-js';
import { Copy } from 'lucide-solid';
import { syntaxHighlight } from '~/utils/syntaxHighlight';

export function JsonViewer(props: { json: string }) {
  const [copied, setCopied] = createSignal(false);
  let copiedTimer: number | undefined;

  const formatted = createMemo(() => {
    try {
      return JSON.stringify(JSON.parse(props.json), null, 2);
    } catch {
      return props.json || '{}';
    }
  });

  async function copy() {
    if (!navigator.clipboard) return;

    try {
      await navigator.clipboard.writeText(formatted());
      setCopied(true);
      window.clearTimeout(copiedTimer);
      copiedTimer = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied by browser policy.
    }
  }

  onCleanup(() => window.clearTimeout(copiedTimer));

  return (
    <div class="json-viewer">
      <div class="json-toolbar">
        <span class="caption">payload</span>
        <button
          type="button"
          class="btn btn-ghost"
          onClick={copy}
          aria-label={copied() ? 'Copied' : 'Copy JSON'}
        >
          <Copy size={16} aria-hidden="true" />
          <span>{copied() ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre class="json-code mono">
        {/* syntaxHighlight escapes all user-visible content before adding spans. */}
        {/* eslint-disable-next-line solid/no-innerhtml */}
        <code innerHTML={syntaxHighlight(formatted())} />
      </pre>
    </div>
  );
}
