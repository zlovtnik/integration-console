import { A } from '@solidjs/router';
import { createSignal, For, Show } from 'solid-js';
import { ChevronDown, ChevronUp, ExternalLink } from 'lucide-solid';
import type { SearchResult } from '~/api/types';
import { domId } from '~/utils/domId';
import { formatDateTime } from '~/utils/formatDateTime';
import { tagClass } from '~/utils/tagClass';
import { BoostBadge } from './BoostBadge';
import { JsonViewer } from './JsonViewer';
import { KindBadge } from './KindBadge';
import { ScoreBar } from './ScoreBar';

type HighlightSegment = {
  text: string;
  highlighted: boolean;
};

function highlightSegments(snippet: string): HighlightSegment[] {
  const segments: HighlightSegment[] = [];
  const tagPattern = /<\/?(em|mark|strong)>/gi;
  let lastIndex = 0;
  let depth = 0;

  for (const match of snippet.matchAll(tagPattern)) {
    if (match.index > lastIndex) {
      segments.push({
        text: snippet.slice(lastIndex, match.index),
        highlighted: depth > 0,
      });
    }

    depth += match[0].startsWith('</') ? -1 : 1;
    depth = Math.max(0, depth);
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < snippet.length) {
    segments.push({
      text: snippet.slice(lastIndex),
      highlighted: depth > 0,
    });
  }

  return segments;
}

export function ResultCard(props: {
  result: SearchResult;
  queryText: string;
  kind: string;
}) {
  const [expanded, setExpanded] = createSignal(false);
  const safeId = () => domId(props.result.source_key);
  const detailId = () => `detail-${safeId()}`;
  const titleId = () => `card-title-${safeId()}`;

  return (
    <article
      class={`result-card result-card--${props.result.source_kind || 'unknown'}`}
      aria-labelledby={titleId()}
      data-source-key={props.result.source_key}
    >
      <header class="card-header">
        <h3 id={titleId()} class="card-title mono">
          {props.result.source_key}
        </h3>
        <div class="card-badges">
          <KindBadge kind={props.result.source_kind || props.kind} />
          <For each={props.result.boost_reasons ?? []}>
            {(reason) => <BoostBadge reason={reason} />}
          </For>
        </div>
      </header>

      <ScoreBar result={props.result} />

      <dl class="card-meta">
        <Show when={props.result.source_mac}>
          <dt class="sr-only">MAC address</dt>
          <dd class="mono caption">{props.result.source_mac}</dd>
        </Show>
        <Show when={props.result.observed_at}>
          <dt class="sr-only">Observed at</dt>
          <dd class="caption">{formatDateTime(props.result.observed_at!)}</dd>
        </Show>
        <Show when={props.result.ssid}>
          <dt class="sr-only">SSID</dt>
          <dd class="caption">{props.result.ssid}</dd>
        </Show>
        <Show when={props.result.sensor_id}>
          <dt class="sr-only">Sensor</dt>
          <dd class="caption">{props.result.sensor_id}</dd>
        </Show>
        <Show when={props.result.location_id}>
          <dt class="sr-only">Location</dt>
          <dd class="caption">{props.result.location_id}</dd>
        </Show>
      </dl>

      <Show when={(props.result.tags ?? []).length > 0}>
        <ul class="tag-list" aria-label="Tags" role="list">
          <For each={props.result.tags}>
            {(tag) => <li class={tagClass(tag)}>{tag}</li>}
          </For>
        </ul>
      </Show>

      <div class="card-actions">
        <button
          type="button"
          class="btn btn-ghost"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded()}
          aria-controls={detailId()}
        >
          <Show
            when={expanded()}
            fallback={<ChevronDown size={16} aria-hidden="true" />}
          >
            <ChevronUp size={16} aria-hidden="true" />
          </Show>
          <span>{expanded() ? 'Hide detail' : 'Show detail'}</span>
        </button>
        <A
          href={`/explain/${encodeURIComponent(props.result.source_key)}?query=${encodeURIComponent(props.queryText)}&kind=${encodeURIComponent(props.kind)}`}
          class="btn btn-ghost"
        >
          <ExternalLink size={16} aria-hidden="true" />
          <span>Explain</span>
        </A>
      </div>

      <Show when={expanded()}>
        <div id={detailId()} class="detail-json">
          <Show when={Object.keys(props.result.highlights ?? {}).length > 0}>
            <div class="detail-highlights">
              <For each={Object.entries(props.result.highlights ?? {})}>
                {([field, snippet]) => (
                  <p class="highlight-row">
                    <span class="highlight-field caption">
                      {field.replace(/_/g, ' ')}
                    </span>
                    <span class="highlight-snippet">
                      <For each={highlightSegments(snippet)}>
                        {(segment) => (
                          <Show
                            when={segment.highlighted}
                            fallback={segment.text}
                          >
                            <mark>{segment.text}</mark>
                          </Show>
                        )}
                      </For>
                    </span>
                  </p>
                )}
              </For>
            </div>
          </Show>
          <JsonViewer json={props.result.detail_json} />
        </div>
      </Show>
    </article>
  );
}
