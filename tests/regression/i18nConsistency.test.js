import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const i18nDir = path.join(repoRoot, 'src', 'i18n');
const htmlPath = path.join(repoRoot, 'public', 'index.html');
const baseLocale = 'en-US';

function readLocale(locale) {
  const filePath = path.join(i18nDir, `${locale}.json`);
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function getLocaleNames() {
  return readdirSync(i18nDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.replace(/\.json$/, ''))
    .sort();
}

function getHtmlI18nKeys() {
  const html = readFileSync(htmlPath, 'utf8');
  return [...new Set([...html.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]))].sort();
}

test('all locale files should have exactly the same keys as en-US', () => {
  const locales = getLocaleNames();
  const baseKeys = Object.keys(readLocale(baseLocale)).sort();

  for (const locale of locales) {
    const localeKeys = Object.keys(readLocale(locale)).sort();
    assert.deepEqual(
      localeKeys,
      baseKeys,
      `${locale} keys mismatch with ${baseLocale}`
    );
  }
});

test('all data-i18n keys in public/index.html should exist in every locale', () => {
  const locales = getLocaleNames();
  const htmlKeys = getHtmlI18nKeys();

  for (const locale of locales) {
    const dict = readLocale(locale);
    const missing = htmlKeys.filter((key) => !(key in dict));
    assert.equal(missing.length, 0, `${locale} is missing html keys: ${missing.join(', ')}`);
  }
});
