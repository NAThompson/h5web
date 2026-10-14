#!/usr/bin/env node
/* Download the tarballs of forked dependencies into `vendor/`, verifying their SHA-256.
 * - `vendor/SHA256SUMS`: `<sha256>  <file>` lines (`shasum -a 256 -c` format)
 * - `vendor/SOURCES`: `<file> <url>` lines (GitHub release assets)
 * Files already present with the expected hash are skipped.
 * Usage: node scripts/fetch-vendor.mjs */
/* eslint-disable no-console, no-await-in-loop -- sequential CLI script */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const vendorDir = path.resolve(import.meta.dirname, '../vendor');

function parse(file) {
  return readFileSync(path.join(vendorDir, file), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split(/\s+/u));
}

const sources = new Map(parse('SOURCES'));
function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

let failed = false;

for (const [expectedHash, file] of parse('SHA256SUMS')) {
  const dest = path.join(vendorDir, file);

  if (existsSync(dest) && sha256(readFileSync(dest)) === expectedHash) {
    console.log(`ok       ${file}`);
    continue;
  }

  const url = sources.get(file);
  if (!url) {
    console.error(`missing  ${file}: no URL in vendor/SOURCES`);
    failed = true;
    continue;
  }

  const res = await fetch(url);
  if (!res.ok) {
    console.error(`failed   ${file}: ${res.status} ${res.statusText} (${url})`);
    failed = true;
    continue;
  }

  const buf = Buffer.from(await res.arrayBuffer());
  const hash = sha256(buf);
  if (hash !== expectedHash) {
    console.error(`mismatch ${file}: expected ${expectedHash}, got ${hash}`);
    failed = true;
    continue;
  }

  writeFileSync(`${dest}.part`, buf);
  renameSync(`${dest}.part`, dest);
  console.log(`fetched  ${file}`);
}

process.exitCode = failed ? 1 : 0;
