# Win conditions: BLAZE Stablecoin Bridge

## What this entry is

An atomic hash-timelock desk between ParyonUSD (PUSD) and MUSD on Bitcoin Cash and USDC on Base, both directions. The desk is the counterparty with owned inventory, the live capacity is printed on the swap card, and anything above it routes to NEAR Intents 1Click.

Host assets: PUSD category `2469acc5afa4b10cb5b5c04afb89c3a3ffd61c5da9c01e26d00951cae2a02544` and MUSD category `b38a33f750f84c5c169a6f23cb873e6e79605021585d4f3408789689ed87f366` on Bitcoin Cash, USDC on Base (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`).

## Rival to beat

BLAZE Swap (entry 51469), https://bck-stack.github.io/blaze-swap/ . The only rival with a true atomic HTLC on both chains. Live desk read on 2026-11-21 11:32 UTC from `https://blaze-desk.launch-engine.workers.dev/api/status`: 0.607 USDC and 0.45 PUSD of inventory, `maxUsdCents 25`, `dailyUsdCents 300`. A $0.50 swap is refused and the desk can pay at most 0.45 PUSD.

The deeper entries, Hashi (51340) and Cashbridge (51471), route through NEAR Intents, THORChain and Cauldron and own no liquidity.

## What a judge gets in the first minute that the rival lacks

1. The swap card opens with the desk's live inventory ("fills up to X USDC / Y PUSD right now") read from the desk wallets, and the quote refuses to promise more than that.
2. A $0.50 PUSD to USDC swap, one WizardConnect signature, no Base wallet needed (paste or generate a Base address), with a per-step tracker, both explorer links and elapsed seconds.
3. Above the desk's inventory the card quotes NEAR Intents 1Click live instead of failing.
4. A replay of past real swaps from the desk's own record, each leg linked to its explorer.
5. Non-custody that can fail: every require in the BCH covenant and the Base contract has a test and a mutation that turns it red (docs and TESTS.md).

## Files

| Path | What |
|---|---|
| `contracts/bch/SwapLock.cash` | BCH covenant: one-in one-out, no-signature claim and refund, 32-byte secret |
| `contracts/evm/src/DeskLock.sol` | Base escrow: permissionless claim to recipient, refund to sender |
| `desk/engine.js` | quote, reserve, lock, relay, refund state machine for both directions |
| `desk/server.js` | local desk service (HTTP API, polling loop, keys from `.env`) |
| `lib/bch.js`, `lib/evm.js` | shared chain code used by the desk and the web app |
| `web/` | static Vite app: swap card, tracker, replay |
| `test/`, `TESTS.md` | contract, engine and mutation evidence |
| `FUNDING.md` | what the desk wallets hold and why |
