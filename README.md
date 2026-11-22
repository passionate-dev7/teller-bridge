# Teller

Atomic swaps between ParyonUSD (PUSD) and MUSD on Bitcoin Cash and USDC on Base, both directions, filled from a funded desk.

The swap card shows what the desk can fill right now, per direction, read from the desk wallets. A swap up to that number is atomic: the user's coins sit in a hash-timelock on one chain, the desk's coins sit in a hash-timelock on the other, and one 32-byte secret opens both. Anything above it is quoted live through NEAR Intents 1Click, so no size fails.

## What a judge gets in the first minute

1. The card opens with two drawers, the PUSD drawer on Bitcoin Cash and the USDC drawer on Base, each showing the live balance, what open quotes have reserved, and "fills up to" under the amount box.
2. 0.50 PUSD to USDC takes one WizardConnect signature and a pasted (or generated) Base address. No Base wallet, no Base gas. The receipt strip prints every leg with elapsed seconds and an explorer link.
3. The other way, USDC on Base to PUSD on Bitcoin Cash, needs a Base wallet (injected or WalletConnect) and no BCH signature at all: the desk relays the claim that pays the user. The browser reads the desk's Bitcoin Cash lock itself and releases its secret only once that lock has a confirmation, so this direction takes one block.
4. Amounts above the desk's inventory show a live NEAR Intents and Cauldron route quote instead of an error.
5. Past swaps replay from the desk's own record, each leg linked to its explorer.

## How a swap works

PUSD to USDC. The browser makes a 32-byte secret and sends the desk only its hash. The desk quotes and reserves the USDC. One wallet signature locks the PUSD in `SwapLock`. The desk sees the lock, locks the USDC on Base for the user's address with a shorter timeout, and the browser hands over the secret. The desk claims the Base lock for the user, then claims the PUSD with the same secret.

USDC to PUSD. The user locks USDC in `DeskLock` on Base. The desk locks PUSD in `SwapLock` for the user's Bitcoin Cash address. The secret goes to the desk, which pays the PUSD out (the covenant forces the output to the user) and claims the USDC.

If anything stalls, both sides time out in the order that keeps the user whole: the desk's lock expires first and returns to the desk, the user's lock expires later and returns to the user, and the desk relays that refund too.

## Non-custody, by construction

| Rule | Where | Test that fails without it |
|---|---|---|
| Claim needs the 32-byte secret, pays exactly the recipient, one input, one output, full token amount, fee capped | `contracts/bch/SwapLock.cash` | `test/bch-contract.test.js`, 14 mutants killed |
| Refund only after the timeout, pays exactly the refund address, same one-in one-out shape | same | same |
| Claim pays the recipient whoever sends it, refund pays the sender and only from the timeout | `contracts/evm/src/DeskLock.sol` | `contracts/evm/test/DeskLock.t.sol`, 18 mutants killed |
| The desk answers only with margin before the user's refund time, never double-locks, refunds and relays refunds | `desk/engine.js` | `test/desk.test.js`, every refund and timeout branch of both directions |
| The browser refuses a quote whose terms differ from what it asked for, a status that names a contract other than the pinned one, and releases its secret only after reading the desk's lock on chain | `lib/client.js` | `test/client.test.js`, `test/security.test.js` |
| A vanished user lock is a recorded loss, never a completed swap; quotes reserve nothing; the desk quotes only near par | `desk/engine.js` | `test/security.test.js` |

`TESTS.md` lists every suite, every mutant and the chipnet transactions of the recorded swaps with their confirmations.

## Evidence

- Live on chipnet with a real EVM node: PUSD to USDC and USDC to PUSD end to end through the desk's HTTP API (`scripts/e2e-live.mjs`), and through the real web app in a real browser, with a headless WizardConnect wallet pairing over the real relays (`scripts/ui-e2e.mjs`) and an EIP-6963 Base wallet (`scripts/ui-e2e-b.mjs`). Transaction ids and confirmations are in `TESTS.md`.
- Refund paths live on chipnet in both directions (`scripts/e2e-refund.mjs`).
- Economics with measured gas and transaction sizes: `docs/ECONOMICS.md`.

## Run it

```
npm install
node scripts/genkeys.mjs                 # keys into the gitignored .env, prints addresses only
npm test                                 # node suites
npm run test:evm                         # forge suite
node scripts/mutate-bch.mjs && node scripts/mutate-evm.mjs && node scripts/mutate-desk.mjs
```

Rehearse it end to end (real chipnet, a local anvil that reports Base Sepolia's chain id):

```
E2E_EVM=anvil DESK_PORT=8790 node --env-file=.env scripts/dev-rig.mjs     # the desk service
VITE_DESK_URL=http://127.0.0.1:8790 VITE_BASE_RPC_URL=http://127.0.0.1:8547 npx vite web
```

Operate it:

```
NETWORK=testnet|mainnet node --env-file=.env scripts/deploy-evm.mjs        # DeskLock, once per chain
NETWORK=testnet|mainnet node --env-file=.env desk/server.js                # the desk (127.0.0.1:8787)
npm run build:web                                                          # static site in web/dist
```

`FUNDING.md` lists what each desk wallet holds. `.env.example` lists the variables, including the Reown project id the WalletConnect button needs.

## Layout

| Path | What |
|---|---|
| `contracts/bch/` | the BCH covenant and its compiled artifact |
| `contracts/evm/` | the Base escrow, a test token for testnets, forge tests |
| `lib/` | shared chain code: BCH locks and spends, Base ids, amounts, WizardConnect signing, client quote checks |
| `desk/` | the counterparty service: engine, chain adapters, store, HTTP server, overflow quotes |
| `web/` | the static app (Vite and React) |
| `scripts/` | keys, deploy, balances, faucet, live and browser end-to-end runs, mutation and evidence runners |
| `docs/` | win conditions, economics, outreach briefs, demo script |
