#!/usr/bin/env node
/**
 * Runs the Symbiosis library page in JSDOM and executes the same audit the
 * Symbiosis Lab runs in the browser.
 *
 * The point of doing it in node as well is that CI has no browser: this is the
 * only place where the shipped page meets a synthetic library of hundreds of
 * files on every push, instead of on a phone once.
 *
 * Usage: node tools/lab-test.mjs [--files 600] [--json]
 */
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { JSDOM } from 'jsdom';

const dir = mkdtempSync(join(tmpdir(), 'symlab-'));
const bundle = join(dir, 'symbiosis.mjs');
execFileSync('npx', ['esbuild', 'src/lib/symbiosis.ts', '--bundle', '--format=esm', `--outfile=${bundle}`, '--log-level=error'], { stdio: 'inherit' });
const lib = await import(`file://${bundle}`);

const html = readFileSync('public/symbiosis/library.html', 'utf8');

const BIG = { games: 120, compressed: 400, unreadable: 6, split: 8, noStorage: true };
const presets = [
  ['обычная библиотека', lib.DEFAULT_LIBRARY],
  ['600 файлов', BIG],
  ['только сжатые', { games: 0, compressed: 250, unreadable: 0, split: 0, noStorage: true }],
];

// jsdom has no layout: the page's own scroll calls must not be the thing that
// decides whether it renders.
const SHIM = `<script>
(function(){
  if (!HTMLElement.prototype.scrollTo) HTMLElement.prototype.scrollTo = function(){};
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = function(){};
  if (!window.requestAnimationFrame) window.requestAnimationFrame = function(f){ return setTimeout(f, 16); };
  if (!window.cancelAnimationFrame) window.cancelAnimationFrame = function(id){ clearTimeout(id); };
})();
</script>`;

let failed = 0;
let passed = 0;

for (const [label, options] of presets) {
  const files = lib.buildLibrary(options);
  const stats = lib.summarise(files);
  const doc = lib.pageWithBridge(html, files, SHIM);
  const dom = new JSDOM(doc, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://lab.local/' });
  const { window } = dom;
  const expected = {
    total: stats.files,
    compressed: stats.compressed,
    runnable: files.filter((f) => f.runnable).length,
    notRunnable: files.filter((f) => !f.runnable).length,
    dlc: stats.dlc,
    updates: stats.updates,
  };
  console.log(`\n── ${label}: ${stats.line}`);
  let checks = [];
  try {
    const raw = window.eval(`window.__labExpected = ${JSON.stringify(expected)}; ${lib.AUDIT_SCRIPT}`);
    checks = JSON.parse(raw);
  } catch (e) {
    checks = [{ name: 'страница выполнилась', ok: false, detail: `исключение при проверке: ${e.message}` }];
  }
  for (const c of checks) {
    console.log(`  ${c.ok ? 'ok  ' : 'FAIL'}  ${c.name}   [${c.detail}]`);
    if (c.ok) passed++; else failed++;
  }
  dom.window.close();
}

console.log(`\npassed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
