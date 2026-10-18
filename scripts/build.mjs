import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'dist');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const item of ['index.html', 'styles.css', 'src', 'assets']) {
  await cp(resolve(root, item), resolve(output, item), { recursive: true });
}
console.log('Built the static RunScope site in dist/.');
