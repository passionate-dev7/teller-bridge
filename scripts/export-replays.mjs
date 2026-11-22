// Exports completed swaps from one or more desk databases to web/public/replays.json: what the web app shows when the
// desk is offline. Secrets and client addresses are dropped; every tx id stays so each leg links to its explorer.
// --local-evm marks swaps whose Base leg ran on a local node, so the app shows those tx ids without an explorer link.
// usage: node scripts/export-replays.mjs <desk.sqlite>... [--limit 12] [--local-evm]
import { writeFileSync, mkdirSync } from 'node:fs';
import { Store } from '../desk/store.js';

const args = process.argv.slice(2);
const reh = args.indexOf('--local-evm');
const localEvm = reh >= 0 && args.splice(reh, 1).length === 1;
const li = args.indexOf('--limit');
const limit = li >= 0 ? Number(args.splice(li, 2)[1]) : 12;
if (!args.length) throw new Error('usage: export-replays.mjs <desk.sqlite>... [--limit N]');
const rows = args.flatMap((db) => new Store(db).recent(['done'], limit))
  .sort((a, b) => b.createdAt - a.createdAt).slice(0, limit)
  .map(({ secret, ip, userBchLock, userBchAddress, userEvm, ...s }) => (localEvm ? { ...s, localEvm: true } : s));
mkdirSync(new URL('../web/public/', import.meta.url), { recursive: true });
writeFileSync(new URL('../web/public/replays.json', import.meta.url), JSON.stringify(rows, null, 1));
console.log('exported', rows.length, 'swaps');
