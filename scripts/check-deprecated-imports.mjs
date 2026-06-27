#!/usr/bin/env node
/**
 * Fail if production src imports archived entry points or _deprecated/ paths.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const webRoot = join(scriptDir, '..');
const root = join(webRoot, 'src');
const BAD = [
  /from\s+['"][^'"]*App_with_ocr/,
  /from\s+['"][^'"]*App_Updated/,
  /from\s+['"][^'"]*_deprecated\//,
  /require\s*\(\s*['"][^'"]*_deprecated\//,
];

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.name === '_deprecated') continue;
    if (e.isDirectory()) walk(p, out);
    else if (/\.(js|jsx|ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

const failures = [];
for (const file of walk(root)) {
  const rel = relative(webRoot, file);
  const code = readFileSync(file, 'utf8');
  for (const re of BAD) {
    if (re.test(code)) {
      failures.push(`${rel}: matches ${re}`);
      break;
    }
  }
}

if (failures.length) {
  console.error('Deprecated import check failed:\n', failures.join('\n'));
  process.exit(1);
}
console.log('check-deprecated-imports: OK');
