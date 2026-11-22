# Design: Teller

Locked design system for the web app. Read before any UI change; amend on purpose.

## System
- Genre: modern-minimal, Swiss signage register, applied to an app screen (the work happens on the screen, there is no marketing page).
- Theme: catalog **Grid** (cool near-white sheet, exposed hairline column grid, one heavy grotesk, one signal ink). Signal ink: signal red.
- Macrostructure: **Window counter**. Left, the swap slip (the one bright object). Right, two inventory gauges (the desk's PUSD drawer on Bitcoin Cash, its USDC drawer on Base) that fill and drain with the live balances and with every quote's reservation. Below the slip, a perforated receipt strip that prints one line per leg with elapsed seconds and explorer links. Past swaps replay on the same strip.
- Primary job of the screen: send a stablecoin across Bitcoin Cash and Base in one signature and see, before signing, what the desk can fill right now.

## Tokens
| Token | Value |
|---|---|
| --color-paper | oklch(99% 0.003 255) |
| --color-paper-2 | oklch(97.2% 0.004 255) |
| --color-paper-3 | oklch(94.5% 0.006 255) |
| --color-ink | oklch(16% 0.010 255) |
| --color-muted | oklch(46% 0.012 255) |
| --color-rule | oklch(86% 0.008 255) |
| --color-signal | oklch(55% 0.21 28) (the only accent: primary button, active step, focus ring) |
| --color-ok | oklch(52% 0.14 155) (confirmed states only) |
| --color-warn | oklch(60% 0.15 70) (over capacity, refund path) |
| --color-bch | oklch(60% 0.15 150) (BCH drawer fill only) |
| --color-base | oklch(50% 0.17 262) (Base drawer fill only) |
| Radius | 0 on panels, 4px on inputs and buttons, 999px on status chips |
| Spacing | 4/8/16/24/32/48 px, 12-column grid, 1px hairlines |
| Motion | gauge fill 600ms ease-out, receipt lines 180ms rise, all gated by prefers-reduced-motion |

## Type
- Display and body: Archivo Variable (wght 400 to 800). Display lowercase 800 at -0.04em; label voice uppercase 12px 600 at +0.09em; no italics.
- Mono (hashes, txids, addresses only): IBM Plex Mono 400/500 at 12px. Amounts use Archivo with tabular-nums, never mono.
- Scale: 12 / 14 / 16 / 20 / 28 / 56.

## Components
- Slip: two stacked rows (you send, you receive) divided by a hairline with a swap control; amount 56px tabular; fiat or consequence line under every amount (fee, minimum received).
- Gauge: a 12px-wide vertical rule with ticks every 25 percent, a fill, the live number above, the label "fills up to" below; the entered amount draws a bracket on the gauge; above capacity the bracket turns warn and the overflow route appears.
- Receipt strip: ruled paper, perforated top and bottom edge made with a repeating radial mask, one mono line per leg, status chip at the end.
- Buttons: one primary per group (signal fill, paper text), secondary bordered, tertiary text link with underline.
- Status: chips with text and a leading dot, never colour alone.

## Copy
Plain English, verbs on buttons, no acronyms on first screen except PUSD and USDC. No invented metrics: every number on screen comes from the desk API or an explorer.

## Bans carried over
Inter, Roboto, Arial; gradients; glass; three equal tiles; emoji icons; em dashes; transition-all; the big-metric tile template.
