export const env = {
  apiBase: import.meta.env.VITE_API_BASE || '',
  appTitle: import.meta.env.VITE_APP_TITLE || 'atheros search',
} as const;

// Backend-only secrets such as API_TOKEN belong on the search API server, not in VITE_* frontend env.
