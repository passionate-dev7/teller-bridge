Written before each fix, run against the code that had the hole (`node --test test/security.test.js`):

| Finding | Test (first run, before the fix) | Result before | Result after |
|---|---|---|---|
| 1 browser reveals on the desk's word | `1 bch2base: the secret is not released on the desk's word...`, `1 base2bch: ...` | red: `client.readyToReveal is not a function` (no gate existed) | green |
| 2 browser trusts server-supplied contract and token | `2 a status that names another DeskLock, token or desk account is refused...` | red: `checkStatus` did not exist, `checkQuote` returned [] for a forged status | green |
| 3 0-conf covers the inventory, vanished lock booked done | `3 the 0-conf limit is at most one dollar`, `3 the user lock vanishes (double-spent) after the desk paid...` | red: `limit is 2500`; state was `done` with the lock gone | green: limit 100, state `loss`, not listed as completed |
| 4 refund_wait never re-reads the BCH lock | `4 base2bch: the desk's BCH refund is lost in the first-seen race...`, `4 ... claim seen only after the Base lock expired...` | red: stayed `refund_wait`, the user was refunded on top of the PUSD | green: desk claims the USDC, or records a loss, and relays no refund |
| 5 quotes reserve inventory for free | `5 one client quoting the whole inventory does not lock everyone else out`, `5 quotes live one minute...`, `5 inventory is reserved when a lock is seen...` | red: second client got `over_capacity`, ttl 600, per-address cap counted quotes only | green |
| 6 forwarded-for spoofing, unbounded rate map | `6 a forwarded-for header is believed only from a loopback proxy...`, `6 the rate limiter forgets old clients...` | red: `clientIp` and `rateLimiter` did not exist, header trusted as sent | green |
| 6 Base log cursor lost after an RPC error | `6 a Base RPC error during the desk lock does not lose the log cursor` | red: log scan started at block 0 and was refused every tick | green |
| 6 no depeg guard | `6 quotes are refused when the PUSD price is more than one percent off par...` | red: quotes were issued at par whatever the price | green |
| startup token check | `6 the desk refuses to start against a DeskLock that holds a different token` | red: `verifyDeployment` did not exist | green |

Every row also has mutants in the desk mutation table below that turn these tests red when the fix is removed.
