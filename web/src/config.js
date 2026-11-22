// a production build without a desk url asks its own origin (no desk there: the app shows the recorded swaps); only the dev server defaults to a local desk
export const DESK_URL = (import.meta.env.VITE_DESK_URL ?? (import.meta.env.PROD ? '' : 'http://127.0.0.1:8787')).replace(/\/$/, '');
export const REOWN_PROJECT_ID = import.meta.env.VITE_REOWN_PROJECT_ID || '';
