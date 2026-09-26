import { afterEach, describe, expect, it } from 'vitest';
import {
  consumeReturnPath,
  isSameOriginRelative,
  saveReturnPath,
} from '~/auth/returnPath';

afterEach(() => {
  window.sessionStorage.clear();
});

describe('auth return path', () => {
  it('accepts same-origin relative destinations', () => {
    expect(isSameOriginRelative('/graph')).toBe(true);
    expect(isSameOriginRelative('/inventory?view=dedup_queue')).toBe(true);
    expect(isSameOriginRelative('/explain/device:aa:bb')).toBe(true);
  });

  it('rejects destinations that could leave the origin', () => {
    expect(isSameOriginRelative('')).toBe(false);
    expect(isSameOriginRelative('graph')).toBe(false);
    expect(isSameOriginRelative('//evil.example/graph')).toBe(false);
    expect(isSameOriginRelative('https://evil.example/graph')).toBe(false);
    expect(isSameOriginRelative('/\\evil.example')).toBe(false);
    expect(isSameOriginRelative('/javascript:alert(1)')).toBe(false);
    expect(isSameOriginRelative('/%2f%2fevil.example')).toBe(false);
    expect(isSameOriginRelative('/%zz')).toBe(false);
  });

  it('round-trips a saved destination exactly once', () => {
    saveReturnPath('/inventory', '?view=dedup_queue&limit=100');
    expect(consumeReturnPath()).toEqual({
      path: '/inventory',
      query: '?view=dedup_queue&limit=100',
    });
    expect(consumeReturnPath()).toBeNull();
  });

  it('drops saved values that are not same-origin relative', () => {
    window.sessionStorage.setItem(
      'atheros-search.auth-return',
      JSON.stringify({ path: 'https://evil.example', query: '' }),
    );
    expect(consumeReturnPath()).toBeNull();

    saveReturnPath('/graph', 'not-a-query');
    expect(consumeReturnPath()).toEqual({ path: '/graph', query: '' });
  });
});
