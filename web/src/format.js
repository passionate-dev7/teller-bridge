import { RATIO } from '../../lib/config.js';

/** "12.5" -> 1250n cents (2 decimals max). Returns null for anything that is not a plain positive decimal. */
export function parseCents(s) {
  const m = /^(\d{0,9})(?:\.(\d{0,2}))?$/.exec(String(s).trim());
  if (!m || (m[1] === '' && !m[2])) return null;
  const c = BigInt(m[1] || '0') * 100n + BigInt((m[2] ?? '').padEnd(2, '0') || '0');
  return c > 0n ? c : null;
}
/** units of the asset the user sends, from cents */
export const sendUnits = (dir, cents) => (dir === 'bch2base' ? cents : cents * RATIO);
export function money(units, decimals, min = 2) {
  const d = 10n ** BigInt(decimals);
  const u = BigInt(units);
  let frac = (u % d).toString().padStart(decimals, '0').replace(/0+$/, '');
  frac = frac.padEnd(min, '0');
  return (u / d).toString() + (frac ? '.' + frac : '');
}
export const short = (s, a = 8, b = 6) => (s && s.length > a + b + 1 ? s.slice(0, a) + '\u2026' + s.slice(-b) : s);
export const ago = (seconds) => (seconds < 90 ? seconds + 's' : Math.round(seconds / 60) + ' min');
