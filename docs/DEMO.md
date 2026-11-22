# Two-minute demo script

Every number on screen comes from the desk API or an explorer. Run the rig (`README.md`, "Rehearse it") and record the page at 1440 by 900.

| Time | What is on screen | What is said |
|---|---|---|
| 0:00 | The card opens with both drawers filled: the PUSD drawer on Bitcoin Cash, the USDC drawer on Base, "fills up to" under the amount. | "The desk holds real inventory, and the card says what it can fill right now." |
| 0:12 | Click Connect, the pairing code appears, scan it with the wallet. | "One WizardConnect pairing. No Base wallet needed for this direction." |
| 0:25 | 0.50 PUSD, paste a Base address, the summary shows lock, receive and refund time. Click Swap, sign once. | "One signature locks the PUSD in a covenant that only the desk can open, and only with my secret." |
| 0:35 | The receipt strip prints each leg with seconds: user lock, desk lock on Base, USDC paid, desk claim. Open the explorer link of one leg. | "The desk answers on Base, pays the USDC, and takes the PUSD with the same secret." |
| 0:55 | The finished receipt: done in seconds, with the elapsed time on the strip. | "Done. Both legs are on their explorers." |
| 1:05 | Flip the direction. Type 50 in the amount box. | "Above the desk's inventory the card does not fail." |
| 1:15 | The warning panel shows the live NEAR Intents and Cauldron route quote. | "It quotes NEAR Intents and Cauldron live for the whole amount." |
| 1:30 | Back to 0.50 USDC, connect a Base wallet, swap. The strip prints lock, desk lock on Bitcoin Cash, PUSD paid. | "Same desk the other way. The PUSD lands without a BCH signature." |
| 1:50 | The proof section and TESTS.md: each rule has a mutant that turns the suite red. | "Delete any rule in either contract and a test fails. That is the non-custody proof." |
