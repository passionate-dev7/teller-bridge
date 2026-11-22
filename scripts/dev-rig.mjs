// Local rehearsal rig for the web app: real chipnet BCH, a local anvil that reports chain id 84532, the real desk service on :8787.
// usage: E2E_EVM=anvil node --env-file=.env scripts/dev-rig.mjs   (then: npm run web)
import { setup } from './e2e-setup.mjs';
const R = await setup({ DESK_PORT: process.env.DESK_PORT ?? '8787', E2E_ANVIL_PORT: process.env.E2E_ANVIL_PORT ?? '8547' });
R.log('rig up. desk http://127.0.0.1:' + (process.env.DESK_PORT ?? '8787'), 'status ready', R.status.ready);
await new Promise(() => {});
