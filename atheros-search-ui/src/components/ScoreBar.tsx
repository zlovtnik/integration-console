import type { SearchResult } from '~/api/types';

function clamp(value: number): number {
  return Math.max(0, Math.min(value, 1));
}

export function ScoreBar(props: { result: Pick<SearchResult, 'score' | 'cosine_similarity' | 'keyword_rank' | 'threat_boost'> }) {
  const scorePercent = () => clamp(props.result.score) * 100;
  const segmentTotal = () =>
    Math.max(
      props.result.cosine_similarity + props.result.keyword_rank + props.result.threat_boost,
      0.001,
    );
  const segmentWidth = (value: number) => `${Math.max(0, (value / segmentTotal()) * 100)}%`;
  const label = () => `Score ${scorePercent().toFixed(1)}%`;

  return (
    <div
      class="score-bar-wrap"
      role="meter"
      aria-valuenow={Number(scorePercent().toFixed(1))}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label()}
    >
      <div class="score-track" aria-hidden="true">
        <div class="score-bar" style={{ width: `${scorePercent()}%` }}>
          <span class="score-seg score-seg--dense" style={{ 'flex-basis': segmentWidth(props.result.cosine_similarity) }} />
          <span class="score-seg score-seg--sparse" style={{ 'flex-basis': segmentWidth(props.result.keyword_rank) }} />
          <span class="score-seg score-seg--threat" style={{ 'flex-basis': segmentWidth(props.result.threat_boost) }} />
        </div>
      </div>
      <span class="score-label mono" aria-hidden="true">
        {scorePercent().toFixed(1)}
      </span>
    </div>
  );
}
