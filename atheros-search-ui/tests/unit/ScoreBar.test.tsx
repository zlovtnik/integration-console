import { render } from '@solidjs/testing-library';
import { describe, expect, it } from 'vitest';
import { ScoreBar } from '~/components/ScoreBar';
import type { SearchResult } from '~/api/types';

const result = {
  score: 0.82,
  cosine_similarity: 0.7,
  keyword_rank: 0.08,
  threat_boost: 0.04,
} as SearchResult;

describe('ScoreBar', () => {
  it('shows the raw rank without percent or additive segments', () => {
    const { getByText, container } = render(() => <ScoreBar result={result} />);
    getByText('Relevance rank: 0.8200');
    getByText('Cosine similarity (unitless, -1 to 1)');
    expect(container.textContent).not.toContain('%');
    expect(container.querySelector('.score-seg')).toBeNull();
  });

  it('announces when no score breakdown is available', () => {
    const { getByText } = render(() => (
      <ScoreBar
        result={
          {
            score: 0,
            cosine_similarity: 0,
            keyword_rank: 0,
            threat_boost: 0,
          } as SearchResult
        }
      />
    ));
    getByText('Relevance rank: 0.0000');
  });
});
