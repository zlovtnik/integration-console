export function friendlyError(
  raw: string,
  status?: number,
): { heading: string; detail: string; action?: string } {
  const statusMatch = raw.match(/^HTTP (\d{3})(?::\s*)?/);
  const resolvedStatus =
    status ?? (statusMatch ? Number(statusMatch[1]) : undefined);
  const detail = statusMatch ? raw.replace(/^HTTP \d{3}:\s*/, '') : raw;

  if (resolvedStatus === 401 || resolvedStatus === 403) {
    return {
      heading: 'Authentication required',
      detail: 'Your session may have expired.',
      action: 'Try refreshing the page.',
    };
  }

  if (resolvedStatus === 404) {
    return {
      heading: 'Not found',
      detail: "The requested resource doesn't exist.",
    };
  }

  if (resolvedStatus && resolvedStatus >= 500) {
    return {
      heading: 'Server error',
      detail:
        'The search service returned an error. This is usually temporary.',
      action: 'Try again in a moment.',
    };
  }

  if (detail.includes('timed out') || detail.includes('TimeoutError')) {
    return {
      heading: 'Search timed out',
      detail: 'The query took too long.',
      action:
        'Try a more specific search, or check the service health indicator.',
    };
  }

  if (detail.includes('Cannot reach') || detail.includes('fetch')) {
    return {
      heading: "Can't reach the search service",
      detail: 'The API is unreachable from your browser.',
      action:
        'Check the status indicator in the top bar, or contact your administrator.',
    };
  }

  return {
    heading: 'Something went wrong',
    detail: detail || 'The search service returned an unexpected error.',
  };
}
