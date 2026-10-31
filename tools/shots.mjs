#!/usr/bin/env node
/**
 * Скриншоты страницы-лаунчера Symbiosis.
 *
 * Страница берётся из `public/symbiosis/library.html` — та самая, что лежит в
 * APK. Библиотека — из `public/fixtures/library.json`: три настоящих файла,
 * записанных `tools/make-fixtures.py` (NSP, XCI, NSZ). Поэтому на снимке
 * реальные имена, реальные размеры и честный вердикт для дампа без ключей, а
 * не выдуманные метаданные.
 *
 *   node tools/shots.mjs            # снимки в shots/
 *   node tools/shots.mjs --studio   # плюс снимок самой студии (нужен dev-сервер)
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const dir = join(tmpdir(), `symshots-${Date.now()}`);
mkdirSync(dir, { recursive: true });
const bundle = join(dir, 'symbiosis.mjs');
execFileSync('npx', ['esbuild', 'src/lib/symbiosis.ts', '--bundle', '--format=esm', `--outfile=${bundle}`, '--log-level=error'], { stdio: 'inherit' });
const lib = await import(`file://${bundle}`);

const OUT = 'shots';
mkdirSync(OUT, { recursive: true });

const page_html = readFileSync('public/symbiosis/library.html', 'utf8');
const fixtures = JSON.parse(readFileSync('public/fixtures/library.json', 'utf8'));

// Библиотека «как на телефоне с дампом»: для второго кадра, чтобы видно было
// разницу между папкой из трёх файлов и дампом из сотен.
const bigLib = lib.buildLibrary({ games: 120, compressed: 400, unreadable: 6, split: 8, noStorage: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: 2,
  locale: 'ru-RU',
  timezoneId: 'Europe/Moscow',
});

async function shot(name, files, steps) {
  const page = await ctx.newPage();
  await page.setContent(lib.pageWithBridge(page_html, files), { waitUntil: 'load' });
  // Заставка снимается по таймеру 700/1200 мс (library.html). Снимок раньше
  // этого ловит логотип и слово «Symbiosis» поверх карусели — то, что на
  // телефоне видно только первые полторы секунды.
  await page.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 5000 });
  if (steps) await steps(page);
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(OUT, name) });
  await page.close();
  console.log('  ', name);
}

const fx = lib.fixturesToFiles(fixtures);

await shot('01-launcher-folder.png', fx, async (page) => {
  // «Лаунчер» - первая вкладка; карусель уже собрана.
  await page.waitForFunction(() => typeof railGames === 'function' && railGames().length > 0);
});

await shot('02-list-folder.png', fx, async (page) => {
  await page.click('#tab-games');
  await page.waitForTimeout(200);
});

await shot('03-why-not-visible.png', fx, async (page) => {
  await page.click('#tab-games');
  await page.waitForTimeout(150);
  await page.click('#btn-why');
});

await shot('04-compressed-tapped.png', fx, async (page) => {
  await page.evaluate(() => {
    const g = GAMES.find((x) => x.kind === 'compressed');
    deadAction(g);
  });
});

await shot('05-converted.png', fx, async (page) => {
  await page.evaluate(() => {
    const g = GAMES.find((x) => x.kind === 'compressed');
    deadAction(g);
  });
  await page.click('#a-conv');
  await page.waitForTimeout(300);
});

// Настоящий дамп без ключей: контейнер разобран, содержимое зашифровано.
// Так выглядит папка с настоящими nsp/xci у человека, который ещё не положил
// prod.keys, - и именно здесь раньше показывался шум из native.
await shot('08-needs-keys.png', fx, async (page) => {
  await page.evaluate(() => {
    const g = GAMES.find((x) => x.needsKeys);
    if (g) play(g);
  });
});

await shot('06-dump-742.png', bigLib, async (page) => {
  await page.click('#tab-games');
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const q = document.getElementById('q');
    q.value = 'zelda';
    q.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const q = document.getElementById('q');
    q.value = '';
    q.dispatchEvent(new Event('input', { bubbles: true }));
    FILTER = 'dead';
    render();
    paintTools();
  });
});

// Студия целиком: правая вкладка Symbiosis после прогона проверок.
if (process.argv.includes('--studio')) {
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Symbiosis', exact: true }).first().click();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /проверить/ }).first().click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(OUT, '07-studio-checks.png') });
  console.log('   07-studio-checks.png');
  await page.close();
}

await browser.close();
console.log(`готово: ${OUT}/`);
