import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { ICONS } from '../js/icons.js';
import { CATEGORIES } from '../js/ui.js';

const source = readdirSync(new URL('../js/', import.meta.url))
  .filter((file) => file !== 'icons.js')
  .map((file) => readFileSync(new URL(`../js/${file}`, import.meta.url), 'utf8'))
  .join('\n');

const quoted = (text) => [...text.matchAll(/'([a-z0-9-]+)'/g)].map((match) => match[1]);

/** Icon names written in the code: icon('x'), iconName: 'x', icon: 'x', backIcon = 'x', and tag(label, variant, 'x'). */
function iconNames() {
  const direct = [...source.matchAll(/(?:\bicon\(|\biconName\s*[:=]\s*|\bicon:\s*|\bbackIcon\s*[:=]\s*)([^,)}]+)/g)].flatMap((match) => quoted(match[1]));
  const tags = [...source.matchAll(/\btag\(([^)]*)\)/g)].map((match) => match[1].split(',')[2] ?? '').flatMap(quoted);
  return [...new Set([...direct, ...tags])].filter((name) => !name.startsWith('icon--'));
}

describe('icons', () => {
  it('finds the icon names used in the code', () => {
    assert.ok(iconNames().length > 30);
  });

  it('draws every icon the code asks for', () => {
    const missing = iconNames().filter((name) => !(name in ICONS));
    assert.deepEqual(missing, []);
  });

  it('has an icon for every category', () => {
    for (const { icon } of Object.values(CATEGORIES)) assert.ok(icon in ICONS, icon);
  });
});
