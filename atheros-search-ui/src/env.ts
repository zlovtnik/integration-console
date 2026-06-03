export const env = {
  apiBase: import.meta.env.VITE_API_BASE || 'http://localhost:8080',
  apiToken: import.meta.env.VITE_API_TOKEN || '',
  appTitle: import.meta.env.VITE_APP_TITLE || 'atheros search',
} as const;
