import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildContract } from '../src/schemas/contract';

const out = join(__dirname, '..', 'contract', 'api-contract.json');
mkdirSync(join(out, '..'), { recursive: true });
writeFileSync(out, `${JSON.stringify(buildContract(), null, 2)}\n`);
console.log(`Wrote ${out}\nCopy it to crystal-ball-frontend/contract/api-contract.json so the frontend contract test checks it.`);
