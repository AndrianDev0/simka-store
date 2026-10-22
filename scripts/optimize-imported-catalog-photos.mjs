import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { optimizeCatalogImage } from '../lib/telegram-image-upload.ts';

const directory = new URL('../catalog-photo-import/', import.meta.url);
const output = new URL('optimized/', directory);
await mkdir(output, { recursive: true });
const sql = ['BEGIN;'];
const report = [];
for (const name of ['warsaw', 'krakow', 'gdansk', 'wroclaw', 'tbilisi', 'batumi', 'barcelona']) {
  const original = await readFile(new URL(`${name}.webp`, directory));
  const optimized = await optimizeCatalogImage(original);
  const previous = createHash('md5').update(original).digest('hex');
  const current = createHash('sha256').update(optimized).digest('hex').slice(0, 32);
  await writeFile(new URL(`${current}.webp`, output), optimized);
  // A new URL preserves immutable caching. Original files remain available for rollback.
  sql.push(`UPDATE product_images SET url='/uploads/catalog/${current}.webp' WHERE url='/uploads/catalog/${previous}.webp';`);
  report.push({ name, original: original.length, optimized: optimized.length });
}
sql.push('COMMIT;');
await writeFile(new URL('optimize.sql', output), sql.join('\n'));
await writeFile(new URL('report.json', output), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
