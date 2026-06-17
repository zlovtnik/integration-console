import { Show } from 'solid-js';
import type { SearchResult } from '~/api/types';

function clamp(value: number): number {
  return Math.max(0, Math.min(value, 1));
}

export function ScoreBar(props: {
  result: Pick<
    SearchResult,
    'score' | 'cosine_similarity' | 'keyword_rank' | 'threat_boost'
  >;
  label?: string;
  variant?: 'breakdown' | 'single';
}) {
  const scorePercent = () => clamp(props.result.score) * 100;
  const denseScore = () => Math.max(0, props.result.cosine_similarity);
  const sparseScore = () => Math.max(0, props.result.keyword_rank);
  const threatScore = () => Math.max(0, props.result.threat_boost);
  const segmentTotal = () => denseScore() + sparseScore() + threatScore();
  const hasBreakdown = () => props.variant !== 'single' && segmentTotal() > 0;
  const segmentWidth = (value: number) =>
    hasBreakdown() ? `${(Math.max(0, value) / segmentTotal()) * 100}%` : '0%';
  const label = () =>
    props.label ??
    (hasBreakdown()
      ? `Score ${scorePercent().toFixed(1)}%`
      : `Score ${scorePercent().toFixed(1)}%, no score breakdown`);

  return (
    <div class="score-meter">
      <div
        class="score-bar-wrap"
        role="meter"
        aria-valuenow={Number(scorePercent().toFixed(1))}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label()}
      >
        <div class="score-track" aria-hidden="true">
          <div
            class={`score-bar ${hasBreakdown() ? '' : 'score-bar--empty'}`}
            style={{ width: `${scorePercent()}%` }}
          >
            <Show when={hasBreakdown()}>
              <span
                class="score-seg score-seg--dense"
                style={{ 'flex-basis': segmentWidth(denseScore()) }}
              />
              <span
                class="score-seg score-seg--sparse"
                style={{ 'flex-basis': segmentWidth(sparseScore()) }}
              />
              <span
                class="score-seg score-seg--threat"
                style={{ 'flex-basis': segmentWidth(threatScore()) }}
              />
            </Show>
          </div>
        </div>
        <span class="score-label mono" aria-hidden="true">
          {scorePercent().toFixed(1)}
        </span>
      </div>

      <Show when={props.variant !== 'single'}>
        <details class="score-legend">
          <summary class="score-legend-toggle">Score breakdown</summary>
          <div class="score-legend-body">
            <Show
              when={hasBreakdown()}
              fallback={
                <span class="score-breakdown-empty">no score breakdown</span>
              }
            >
              <span class="score-seg--dense score-swatch" />
              <span>Semantic match</span>
              <span class="score-seg--sparse score-swatch" />
              <span>Keyword match</span>
              <span class="score-seg--threat score-swatch" />
              <span>Threat boost</span>
            </Show>
          </div>
        </details>
      </Show>
    </div>
  );
}
