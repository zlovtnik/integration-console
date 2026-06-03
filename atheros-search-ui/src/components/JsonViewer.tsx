import { createMemo, createSignal } from 'solid-js';
import { Copy } from 'lucide-solid';
import { syntaxHighlight } from '~/utils/syntaxHighlight';

export function JsonViewer(props: { json: string }) {
  const [copied, setCopied] = createSignal(false);

  const formatted = createMemo(() => {
    try {
      return JSON.stringify(JSON.parse(props.json), null, 2);
    } catch {
      return props.json || '{}';
    }
  });

  async function copy() {
    await navigator.clipboard?.writeText(formatted());
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div class="json-viewer">
      <div class="json-toolbar">
        <span class="caption">payload</span>
        <button type="button" class="btn btn-ghost" onClick={copy} aria-label={copied() ? 'Copied' : 'Copy JSON'}>
          <Copy size={16} aria-hidden="true" />
          <span>{copied() ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre class="json-code mono">
        {/* eslint-disable-next-line solid/no-innerhtml */}
        <code innerHTML={syntaxHighlight(formatted())} />
      </pre>
    </div>
  );
}
