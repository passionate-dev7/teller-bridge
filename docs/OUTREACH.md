# Partner briefs

Dated 2026-11-21. One message per ecosystem, each asking for one concrete thing and offering one concrete thing.

## ParyonUSD (PUSD) team

Subject: an atomic PUSD to USDC desk on Base, listing request

The Teller desk swaps PUSD and USDC on Base in both directions with hash-timelocks on both chains: the user's PUSD sits in a CashScript covenant that pays the desk only with the user's secret and pays the user back after a timeout. The desk holds its own PUSD and USDC and publishes the live fill capacity at `/api/status`. A $0.50 swap completes in about 10 to 35 seconds on the test rig.
Ask: list the desk as a PUSD to USDC route on the ParyonUSD site and in the app, and tell us the redemption floor so the card can show it next to the Cauldron price.
Offer: the desk code is open (`contracts/bch/SwapLock.cash` and `desk/`), and the card already shows the Cauldron price of PUSD against the $1.0000 desk rate.

## MUSD team

Subject: MUSD on the same desk

The desk lists every BCH stable it holds: `MUSD` is configured with category `b38a33f750f84c5c169a6f23cb873e6e79605021585d4f3408789689ed87f366` and fills as soon as the desk wallet holds some.
Ask: seed the MUSD drawer with a small float or point us at a market maker that does.
Offer: MUSD to USDC on Base with the same covenant and the same refund guarantees.

## NEAR Intents (1Click)

Subject: instant lane in front of 1Click

Above the desk's inventory the Teller card quotes 1Click live (BCH to USDC on Base, with Cauldron for the PUSD leg).
Ask: a partner JWT for the fee-free quote tier and a link from the BCH page to the desk as the instant lane for small PUSD swaps.
Offer: the desk reports its live capacity per direction, so 1Click can route sub-capacity swaps to it.

## THORChain

Subject: the BCH leg as a desk, and a THORChain overflow route

Ask: confirm the memo format for a BCH to USDC route we can quote next to 1Click in the overflow lane.
Offer: an atomic lane for small stable swaps that THORChain's minimums price out.

## ShapeShift

Subject: PUSD and MUSD in the swapper

Ask: the best contact for adding PUSD and MUSD on Bitcoin Cash to the swapper's asset list.
Offer: the desk as a liquidity source with published capacity and a 0.30 percent fee.
