const RETURN_PATH_KEY = 'atheros-search.auth-return';

/**
 * The full same-origin path and query to restore after authentication,
 * or null when nothing was saved.
 */
export interface AuthReturnPath {
  path: string;
  query: string;
}

export function saveReturnPath(path: string, query: string): void {
  if (typeof window === 'undefined') return;
  if (!isSameOriginRelative(path)) return;
  try {
    window.sessionStorage.setItem(
      RETURN_PATH_KEY,
      JSON.stringify({ path, query } satisfies AuthReturnPath),
    );
  } catch {
    // sessionStorage may be unavailable; authentication then lands on the
    // default search page, which is acceptable.
  }
}

/**
 * Restore the saved return path and clear it. Returns null when nothing
 * was saved or the saved value is not a same-origin relative path.
 */
export function consumeReturnPath(): AuthReturnPath | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(RETURN_PATH_KEY);
    if (raw === null) return null;
    window.sessionStorage.removeItem(RETURN_PATH_KEY);
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const candidate = parsed as Partial<AuthReturnPath>;
    if (typeof candidate.path !== 'string' || !isSameOriginRelative(candidate.path)) {
      return null;
    }
    const query =
      typeof candidate.query === 'string' && candidate.query.startsWith('?')
        ? candidate.query
        : '';
    return { path: candidate.path, query };
  } catch {
    return null;
  }
}

/**
 * Only same-origin relative paths may be restored. Absolute URLs, protocol
 * relative URLs, and paths with schemes are rejected to prevent open
 * redirects through the authentication return flow.
 */
export function isSameOriginRelative(path: string): boolean {
  if (path === '' || !path.startsWith('/') || path.startsWith('//')) return false;
  // Browsers treat backslashes as slashes when resolving a path, and
  // percent-encoded separators must not be trusted to stay on this origin.
  if (path.includes('\\')) return false;
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return false;
  }
  if (decoded.startsWith('//') || decoded.includes('\\')) return false;
  // Disallow scheme-like prefixes such as "/javascript:" that a browser
  // might treat as a URL after navigation.
  if (/^[a-z][a-z0-9+.-]*:/i.test(decoded.slice(1))) return false;
  const control = new URL('http://control.invalid');
  try {
    if (new URL(path, control).origin !== control.origin) return false;
  } catch {
    return false;
  }
  return true;
}