import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';

test('approved brand has scoped depth, one-time motion and reduced-motion fallback', async () => {
  const source = await readFile(new URL('../app/components/brand-mark.tsx', import.meta.url), 'utf8');
  assert.ok(source.includes('aria-label="симка"'));
  assert.ok(source.includes('.simka-brand>g{filter:drop-shadow'));
  assert.ok(source.includes('@media(prefers-reduced-motion:reduce){.simka-word{animation:none}}'));
  assert.ok(!source.includes('infinite'));
  assert.ok(source.includes('.simka-brand{color:#10213a;'));
  assert.ok(source.includes('.dark .simka-brand{color:#f8fafc;'));
  assert.ok(source.includes('--brand-edge:#5078ac'));
  assert.ok(!source.includes('dark:text-white'));
  assert.ok(!source.includes('svg>g{'));
});

test('both site headers use the shared logo without the old duplicate text', async () => {
  for (const file of ['../app/storefront.tsx', '../app/components/site-shell.tsx']) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.ok(source.includes('import { BrandMark }'));
    assert.ok(!source.includes('max-[359px]:hidden">SIMKA</span>'));
  }
});
