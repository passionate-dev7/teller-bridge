# Desk economics

The desk charges **0.30 percent** of the amount sent (`FEE_BPS=30`), both directions, at a 1 to 1 rate between one BCH stable and one USDC. It pays every network fee on its own side, including the gas of the claim it relays for the user, so a user with only a BCH wallet needs no Base gas and a user with only a Base wallet needs no BCH.

## What a swap costs the desk

Measured, not estimated.

| Item | Value | Source |
|---|---|---|
| BCH lock transaction (desk locks a stable) | 478 bytes | chipnet tx `733ae701fffc41d68d688725abdabb31a777089c6f9c12eb7643cbc74b635aa0`, 55 confirmations when read |
| BCH claim transaction | 336 bytes | chipnet tx `40f467cbf6e24a8d9869003a84b2c560e166fa1ef9b11bb5d4d85419c29fc1b1` |
| BCH fee rate used | 1.2 sat per byte | `FEE_RATE` in `lib/bch.js` |
| Base `lock` | 153,321 gas | `forge test --gas-report`, `contracts/evm/test/DeskLock.t.sol` |
| Base `claim` | up to 62,305 gas | same report |
| Base `refund` | up to 43,773 gas | same report |
| Base gas price | 0.006 gwei | `eth_gasPrice` on `https://mainnet.base.org` at block 60381665 |
| ETH price | $1670.83 | NEAR Intents token list, 2026-11-21 |
| BCH price | $194.98 | NEAR Intents token list, 2026-11-21 |

BCH to Base swap: Base lock plus relayed claim is 215,626 gas, about $0.0022, plus a 336 byte BCH claim, about 404 sats or $0.0008. Total about $0.003.
Base to BCH swap: a 478 byte BCH lock and a 336 byte relayed claim, 978 sats or $0.0019, plus a 62,305 gas Base claim, about $0.0006. Total about $0.0025.
The 3000 sats that ride in each swap lock return to the desk on every claim and refund.

The Base L1 data fee is excluded; it depends on calldata and sits on top of the gas figures.

## Where the fee covers the cost

At 0.30 percent the fee equals the measured cost at a swap size of about $1.00. A $5 swap earns $0.015 against $0.003 of cost. The $0.50 first-minute swap is the desk's own marketing spend: it earns $0.0015 and costs about $0.003.

## Inventory and capacity

The card prints what the desk can fill right now, per direction: the desk wallets' balances minus what open quotes have reserved. A quote that would exceed it is refused with the live maximum, and the card routes the amount through NEAR Intents (live quote shown) instead of failing.

Inventory is the only scaling lever: capacity per direction equals the funded balance, so doubling the float doubles the largest instant swap.

## Partners

`docs/OUTREACH.md` holds the briefs for ParyonUSD, MUSD, NEAR Intents, THORChain and ShapeShift. The desk's `/api/status` endpoint publishes capacity in a machine-readable form so a router can quote the desk as an instant lane.
