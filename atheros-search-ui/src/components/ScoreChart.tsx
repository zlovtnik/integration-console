import { For } from 'solid-js';
import type { ExplainResponse } from '~/api/types';

export function ScoreChart(props: { explain: ExplainResponse }) {
  const factors = () => [
    {
      label: 'Cosine similarity',
      method: 'Vector cosine, unitless (-1 to 1)',
      value: props.explain.dense_score,
    },
    {
      label: 'Keyword rank',
      method: 'PostgreSQL ts_rank_cd, unitless',
      value: props.explain.sparse_score,
    },
    {
      label: 'Relevance rank',
      method:
        (props.explain.ranking_method === 'hybrid'
          ? 'Reciprocal rank fusion'
          : props.explain.ranking_method === 'sparse'
            ? 'PostgreSQL ts_rank_cd'
            : props.explain.ranking_method === 'dense'
              ? 'Vector cosine'
              : 'Method unavailable') + ', unitless',
      value: props.explain.fused_score,
    },
    {
      label: 'Threat ranking adjustment',
      method: 'Signature boost, unitless rank',
      value: props.explain.threat_boost,
    },
  ];
  return (
    <div>
      <dl class="graph-detail-list">
        <For each={factors()}>
          {(factor) => (
            <div>
              <dt>
                {factor.label} ({factor.method})
              </dt>
              <dd>
                {factor.value == null ? 'Unavailable' : factor.value.toFixed(4)}
              </dd>
            </div>
          )}
        </For>
      </dl>
      <p>
        These factors use different scales. They are not additive components or
        identity/risk probabilities.
      </p>
    </div>
  );
}
