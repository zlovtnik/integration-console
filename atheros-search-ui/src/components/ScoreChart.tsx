import { For } from 'solid-js';
import type { ExplainResponse } from '~/api/types';

export function ScoreChart(props: { explain: ExplainResponse }) {
  const score = (value: number | null | undefined) => value ?? 0;
  const denseScore = () => score(props.explain.dense_score);
  const sparseScore = () => score(props.explain.sparse_score);
  const fusedScore = () => score(props.explain.fused_score);
  const threatBoost = () => score(props.explain.threat_boost);
  const bars = () => [
    { label: 'Dense', value: denseScore(), className: 'chart-fill--dense' },
    { label: 'Sparse', value: sparseScore(), className: 'chart-fill--sparse' },
    { label: 'Fused', value: fusedScore(), className: 'chart-fill--fused' },
    { label: 'Boost', value: threatBoost(), className: 'chart-fill--threat' },
  ];

  return (
    <figure class="score-chart-figure" aria-label="Score breakdown chart">
      <figcaption class="sr-only">
        Score breakdown: dense {denseScore().toFixed(3)}, sparse{' '}
        {sparseScore().toFixed(3)}, fused {fusedScore().toFixed(3)}, threat
        boost {threatBoost().toFixed(3)}.
      </figcaption>
      <div class="score-chart" role="presentation">
        <For each={bars()}>
          {(bar) => (
            <div class="chart-row">
              <span class="chart-label">{bar.label}</span>
              <div class="chart-track" aria-hidden="true">
                <div
                  class={`chart-fill ${bar.className}`}
                  style={{
                    width: `${Math.max(0, Math.min(bar.value, 1)) * 100}%`,
                  }}
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
