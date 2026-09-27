import { Show } from 'solid-js';
import type { SearchResult } from '~/api/types';

export function ScoreBar(props: {
  result: Pick<
    SearchResult,
    'score' | 'cosine_similarity' | 'keyword_rank' | 'threat_boost'
  >;
  label?: string;
  variant?: 'breakdown' | 'single';
}) {
  return (
    <div class="score-meter">
      <span class="mono">
        {props.label ?? 'Relevance rank'}: {props.result.score.toFixed(4)}
      </span>
      <Show when={props.variant !== 'single'}>
        <details class="score-legend">
          <summary>Raw ranking factors</summary>
          <dl>
            <dt>Cosine similarity (unitless, -1 to 1)</dt>
            <dd>{props.result.cosine_similarity.toFixed(4)}</dd>
            <dt>Keyword rank (PostgreSQL ts_rank_cd, unitless)</dt>
            <dd>{props.result.keyword_rank.toFixed(4)}</dd>
            <dt>Threat ranking adjustment (unitless rank)</dt>
            <dd>{props.result.threat_boost.toFixed(4)}</dd>
          </dl>
          <p>
            Ranking factors use different scales. They are not identity or risk
            probabilities.
          </p>
        </details>
      </Show>
    </div>
  );
}
