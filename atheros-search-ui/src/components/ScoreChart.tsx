import { For } from 'solid-js';
import type { ExplainResponse } from '~/api/types';

export function ScoreChart(props: { explain: ExplainResponse }) {
  const bars = () => [
    { label: 'Dense', value: props.explain.dense_score, className: 'chart-fill--dense' },
    { label: 'Sparse', value: props.explain.sparse_score, className: 'chart-fill--sparse' },
    { label: 'Fused', value: props.explain.fused_score, className: 'chart-fill--fused' },
    { label: 'Boost', value: props.explain.threat_boost, className: 'chart-fill--threat' },
  ];

  return (
    <figure class="score-chart-figure" aria-label="Score breakdown chart">
      <figcaption class="sr-only">
        Score breakdown: dense {props.explain.dense_score.toFixed(3)}, sparse{' '}
        {props.explain.sparse_score.toFixed(3)}, fused {props.explain.fused_score.toFixed(3)},
        threat boost {props.explain.threat_boost.toFixed(3)}.
      </figcaption>
      <div class="score-chart" role="presentation">
        <For each={bars()}>
          {(bar) => (
            <div class="chart-row">
              <span class="chart-label">{bar.label}</span>
              <div class="chart-track" aria-hidden="true">
                <div
                  class={`chart-fill ${bar.className}`}
                  style={{ width: `${Math.max(0, Math.min(bar.value, 1)) * 100}%` }}
                />
              </div>
              <span class="chart-value mono">{bar.value.toFixed(3)}</span>
            </div>
          )}
        </For>
      </div>
    </figure>
  );
}
