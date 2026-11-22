# Reference research (captured 2026-11-21 with refshot.py in the deepsurge profile)

## BLAZE Swap (direct competitor, same chains, same assets)
Product screen: the live swap card at https://bck-stack.github.io/blaze-swap/ with the four-step "lock / desk locks / release / desk takes" panel to its right. PNGs: design-research/refs/blazeswap-1440.png, design-research/refs/blazeswap-390.png, tokens in blazeswap-1440.tokens.json.
Measured: body bg rgb(7,11,14) on a green-to-navy radial wash, Inter 16px / h1 Inter 700 46.4px tracking -0.928px, input JetBrains Mono 12.8px radius 10px bg rgb(7,11,14) padding 8px 9.6px, chips radius 999px padding 3.5px 9.6px.
Worth stealing: the two-column rhythm of "your move" on the left and a numbered step ladder on the right that says what each lock means in one sentence; amount chips ($0.05, $0.10, $0.25); the "Watch a real mainnet swap" button that needs no wallet; elapsed seconds on each past swap (4.2 s, 10.2 s).
How it shows numbers: "Desk liquidity: 0.60743 USDC on Base" as one grey sentence under the button, 13px, not a gauge. Empty state is the connect-wallet button.
Do NOT take: the dark teal wash, Inter everywhere, the capacity shown as a footnote (we make capacity the primary object), the subscription-feature copy block.

## Hashi (deepest rival, NEAR Intents and THORChain routes)
Product screen: the swap widget inside the phone frame at https://hashi.cash/ with route cards below. PNGs: design-research/refs/hashi-1440.png, design-research/refs/hashi-390.png, tokens in hashi-1440.tokens.json.
Measured: body bg rgb(15,14,14), text rgb(255,250,245), h1 Figtree 500 104px tracking -4.68px leading 98.8px, labels Geist Mono 12px tracking 0.96px uppercase, pills radius full with padding 2px 8px, accent orange on the Open app button.
Worth stealing: ranked route list with a "Best return" tag; asset chips that carry a real token logo and the chain under the symbol; the live price chip "PUSD $1.0046, 56 pools on Cauldron" which gives every number a consequence; the status banner "Partly paused" as a labelled chip, not colour alone.
How it shows numbers: YOU PAY / YOU RECEIVE with a dollar value under each amount, 100 and 98.62 at roughly 32px, route table under the fold.
Do NOT take: the 104px marketing headline that pushes the tool below the fold, the phone mockup chrome, the dark glow gradient.

## Cashbridge (widest rival, 20 source chains)
Product screen: the Cashbridge Router swap card on https://www.cashbridge.space/ . PNGs: design-research/refs/cashbridge-1440.png, design-research/refs/cashbridge-390.png, tokens in cashbridge-1440.tokens.json.
Measured: page bg rgb(250,250,250) hero region dark green-black, h1 crit 600 82px tracking -3.28px, eyebrow labels 13px 600 tracking 1.04px colour rgb(63,224,180), buttons radius 4px, a white card with a 1px divider between the send and receive rows.
Worth stealing: the white slip card as the single bright object on a dark page, split into send and receive halves by a hairline with a swap arrow; the helper line "No BCH signature required from the recipient" printed under the address field; the Router toggle that states who signs.
How it shows numbers: 100 and 99.84 at 40px with the dollar value in 14px grey beneath. Empty state is a ghost placeholder address field.
Do NOT take: the pre-existing-project banner stacked above the nav, 20 chain logos as a hero row, the mint-on-black palette.

## Jumper (category leader for swap and bridge, used for the swap-flow grammar)
Product screen: the Send / Select panel at https://jumper.exchange/ . PNGs: design-research/refs/jumper-1440.png, design-research/refs/jumper-390.png, tokens in jumper-1440.tokens.json.
Measured: body bg rgb(18,11,30), h1 Urbanist 700 64px, amount input Inter 700 30px, nav buttons radius 12px height about 40px, three stat tiles 136px wide radius 16px.
Worth stealing: one amount field at 30px as the focal object; settings gear for slippage; sidebar nav is secondary and collapsible so the swap panel owns the viewport.
How it shows numbers: "0" with $0.00 beneath at 12px; the stat tiles (64 chains, 38 bridges, 48 DEXs) are the big-metric template and are not a model for ours.
Do NOT take: the purple gradient, the stat tiles, the sidebar. It is kept as the negative reference in design-research/negative/jumper-purple-gradient-1440.png.
