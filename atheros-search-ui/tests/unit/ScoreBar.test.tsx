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
  it('announces score to assistive technology', () => {
    const { getByRole } = render(() => <ScoreBar result={result} />);
    const meter = getByRole('meter');

    expect(meter).toHaveAttribute('aria-valuenow', '82');
    expect(meter).toHaveAttribute('aria-label', 'Score 82.0%');
  });

  it('announces when no score breakdown is available', () => {
    const { getByRole, getByText } = render(() => (
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
    const meter = getByRole('meter');

    expect(meter).toHaveAttribute(
      'aria-label',
      'Score 0.0%, no score breakdown',
    );
    getByText('no score breakdown');
  });
});
