// Compiles contracts/bch/*.cash to artifacts used by the desk and the web app. Optional argv: source path, output path.
import { compileFile } from 'cashc';
import { writeFileSync } from 'node:fs';
const src = process.argv[2] ?? new URL('../contracts/bch/SwapLock.cash', import.meta.url).pathname;
const out = process.argv[3] ?? new URL('../contracts/bch/SwapLock.artifact.json', import.meta.url).pathname;
writeFileSync(out, JSON.stringify(compileFile(src), null, 2));
console.log('compiled', src, '->', out);
