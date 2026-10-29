import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from 'vitest';

/*
 * Attribute names are read as quoted string literals (`'H5WEB_vis'`), so a regex finds them; names
 * in comments (in backticks) don't count. The only name built at runtime, `H5WEB_${channel}` in
 * `core/scatter/source.ts`, reads `H5WEB_z`, `H5WEB_color` and `H5WEB_size`, which are also read
 * as literals elsewhere (checked below).
 */
const NAME = /["'](H5WEB_\w+)/gu;
const SRC_DIR = path.resolve(import.meta.dirname, '../..');
const DOC = readFileSync(
  path.resolve(SRC_DIR, '../../../docs/view-hints.md'),
  'utf8',
);
const SKILL = readFileSync(
  path.resolve(SRC_DIR, '../../../docs/view-hints-skill.md'),
  'utf8',
);

/* Quoted names in the source that are not attributes to document: none for now. (`H5WEB_VIEW_SCHEMA`
 * only appears in a comment of `core/scatter/source.ts`, as the name of a schema document, and is
 * not quoted, so it is not found.) */
const NOT_ATTRIBUTES = new Set<string>();

function namesIn(text: string, pattern: RegExp): Set<string> {
  return new Set([...text.matchAll(pattern)].map(([, name]) => name));
}

/* Attribute names in the app's source, outside tests and mock data */
function sourceNames(): Set<string> {
  const files = readdirSync(SRC_DIR, { recursive: true, encoding: 'utf8' });
  return new Set(
    files
      .filter((file) => /\.tsx?$/u.test(file) && !/mock|test/u.test(file))
      .flatMap((file) => [
        ...namesIn(readFileSync(path.join(SRC_DIR, file), 'utf8'), NAME),
      ]),
  );
}

test('source names include the scatter channels read by template literal', () => {
  const known = sourceNames();
  for (const channel of ['x', 'y', 'z', 'color', 'size']) {
    expect(known).toContain(`H5WEB_${channel}`);
  }
});

// An attribute is documented by a table row of its own: in the row's first cell
test('every attribute read by the app has a row in the doc', () => {
  const firstCells = [...DOC.matchAll(/^\|([^|]*)\|/gmu)].map(([, c]) => c);
  const docNames = namesIn(firstCells.join(' '), /`(H5WEB_\w+)`/gu);
  const read = sourceNames();

  expect(read.size).toBeGreaterThan(80);
  expect(
    [...read].filter(
      (name) => !docNames.has(name) && !NOT_ATTRIBUTES.has(name),
    ),
  ).toEqual([]);
});

test('every attribute in the doc and the skill is read by the app', () => {
  const known = sourceNames();
  const documented = namesIn(DOC + SKILL, /\b(H5WEB_\w+)/gu);

  expect([...documented].filter((name) => !known.has(name))).toEqual([]);
});

// The VS Code extension fills in the path of its copy of the doc
test('the skill links to the installed doc', () => {
  expect(SKILL).toContain('{{VIEW_HINTS_PATH}}');
});
