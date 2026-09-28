import { describe, expect, it } from 'vitest';
import { callbackUri, logoutUri } from '~/auth/session';

describe('authentication redirect URIs', () => {
  it('uses the registered callback URI for sign-in', () => {
    expect(callbackUri()).toBe(`${window.location.origin}/callback`);
  });

  it('uses the slash-terminated registered root for sign-out', () => {
    expect(logoutUri()).toBe(`${window.location.origin}/`);
  });
});
