import { strict as assert } from 'node:assert';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

const sw = read('sw.js');
const cached = [...sw.slice(sw.indexOf('const FILES = ['), sw.indexOf('];')).matchAll(/'([^']+)'/g)].map((match) => match[1]);
const manifest = JSON.parse(read('manifest.webmanifest'));

/** Width and height from a PNG's IHDR chunk. */
function pngSize(path) {
  const bytes = readFileSync(new URL(path, root));
  assert.equal(bytes.toString('ascii', 1, 4), 'PNG', `${path} is a PNG`);
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
}

describe('offline app', () => {
  it('ships the same version in the app and the service worker', () => {
    const version = (text) => /const VERSION = '([^']+)'/.exec(text)?.[1];
    assert.ok(version(sw));
    assert.equal(version(read('js/app.js')), version(sw));
  });

  it('caches only files that exist', () => {
    for (const file of cached.filter((f) => f !== './')) assert.ok(existsSync(new URL(file, root)), file);
  });

  it('caches every script and style sheet', () => {
    for (const dir of ['js', 'css']) {
      for (const file of readdirSync(new URL(`${dir}/`, root))) assert.ok(cached.includes(`${dir}/${file}`), `${dir}/${file} is missing from sw.js`);
    }
  });

  it('caches everything the page loads', () => {
    const page = read('index.html');
    const references = [...page.matchAll(/(?:href|src)="([^"#:]+)"/g)].map((match) => match[1]);
    assert.ok(references.length > 5);
    for (const reference of references) assert.ok(cached.includes(reference), `${reference} is missing from sw.js`);
  });

  it('has the icons the manifest promises, in their sizes', () => {
    for (const { src, sizes } of manifest.icons) {
      assert.ok(cached.includes(src), `${src} is missing from sw.js`);
      assert.equal(pngSize(src), sizes);
    }
    assert.equal(pngSize('icons/apple-touch-icon.png'), '180x180');
  });

  it('starts and stays inside its own folder, so it works under any GitHub Pages path', () => {
    assert.equal(manifest.start_url, './');
    assert.equal(manifest.scope, './');
    assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable'));
  });
});
