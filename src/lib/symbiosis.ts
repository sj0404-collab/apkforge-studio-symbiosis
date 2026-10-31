/**
 * Symbiosis Lab — a real harness for the emulator's library page.
 *
 * The page under test (`patch/android/assets/library.html` in the Symbiosis
 * repository) is shipped inside an APK and talks to Kotlin through
 * `window.Symbiosis`. Nothing in the studio could load it, so every bug in it
 * — including "one game out of hundreds" — was found by squinting at a phone.
 *
 * This module builds the data the page would get from a real device
 * (`buildLibrary`), the bridge object that feeds it (`buildBridge`), and the
 * checks that decide whether the page is actually showing the library
 * (`AUDIT_SCRIPT`). The script runs *inside* the iframe, in the page's own
 * realm, so it exercises the shipped functions rather than a copy of them.
 */

export interface SymbiosisFile {
  name: string;
  /** Строка под названием. Пустая - не показывать ничего выдуманного. */
  developer?: string;
  /** Что получилось после распаковки — из tools/make-fixtures.py. */
  converted?: { name: string; bytes: number; format: string };
  titleId: string;
  version: string;
  kind: 'game' | 'update' | 'dlc' | 'compressed' | 'split' | 'unreadable';
  runnable: boolean;
  reason?: string;
  bytes: number;
}

export interface LibraryOptions {
  /** Base games. Each gets an update and, every third game, two DLC files. */
  games: number;
  /** Compressed dumps (nsz/xcz) — the files that used to vanish. */
  compressed: number;
  /** Files whose header could not be read (bad keys). */
  unreadable: number;
  /** Split NSP parts, two per split game. */
  split: number;
  /** Seal the page in a sandbox without storage, as the preview does. */
  noStorage: boolean;
}

export const DEFAULT_LIBRARY: LibraryOptions = {
  games: 24,
  compressed: 180,
  unreadable: 3,
  split: 2,
  noStorage: true,
};

function humanSize(bytes: number): string {
  if (bytes <= 0) return '0 КБ';
  // Русская типографика: разделитель - запятая, и на терабайтах «2392,8 ГБ»
  // читается хуже, чем «2,3 ТБ».
  const ru = (v: number, digits = 1) => v.toFixed(digits).replace('.', ',');
  const tb = bytes / 1_099_511_627_776;
  if (tb >= 1) return `${ru(tb)} ТБ`;
  const gb = bytes / 1_073_741_824;
  if (gb >= 1) return `${ru(gb)} ГБ`;
  const mb = bytes / 1_048_576;
  if (mb >= 1) return `${ru(mb, 0)} МБ`;
  return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
}

function hex(n: number, pad = 16) {
  return n.toString(16).toUpperCase().padStart(pad, '0');
}

/** Title IDs follow the console layout: `…000` base, `…800` update, `…001+` DLC. */
function titleId(index: number, role: 'base' | 'update' | 'dlc', dlcIndex = 0) {
  const low = role === 'base' ? 0x000 : role === 'update' ? 0x800 : 0x100 + dlcIndex;
  return `0100${hex(index + 1, 8)}${hex(low, 4)}`;
}

const TITLES = [
  'Blade Chimera', 'Hollow Knight', 'Celeste', 'Dead Cells', 'Hades',
  'Ori and the Blind Forest', 'Metroid Dread', 'Splatoon 3', 'Mario Kart 8 Deluxe',
  'Kirby and the Forgotten Land', 'Xenoblade Chronicles 3', 'Bayonetta 3',
  'Triangle Strategy', 'Octopath Traveler II', 'Fire Emblem Engage',
];

export function buildLibrary(options: LibraryOptions = DEFAULT_LIBRARY): SymbiosisFile[] {
  const out: SymbiosisFile[] = [];
  const gameCount = Math.max(0, options.games);

  for (let i = 0; i < gameCount; i++) {
    const base = titleId(i, 'base');
    const title = `${TITLES[i % TITLES.length]} ${i + 1}`;
    out.push({
      name: `${title} [${base}][v0].nsp`,
      titleId: base,
      version: '',
      kind: 'game',
      runnable: true,
      bytes: 1_900_000_000 + i * 7_000_000,
    });
    // Every game has an update — 24 games means 48 files, not 24.
    out.push({
      name: `${title} [${titleId(i, 'update')}][v${65536 * (1 + (i % 3))}][UPD].nsp`,
      titleId: titleId(i, 'update'),
      version: `${1 + (i % 3)}.0.0`,
      kind: 'update',
      runnable: true,
      bytes: 900_000_000 + i * 3_000_000,
    });
    if (i % 3 === 0) {
      for (let d = 1; d <= 2; d++) {
        out.push({
          name: `${title} [${titleId(i, 'dlc', d)}][DLC] Pack ${d}.nsp`,
          titleId: titleId(i, 'dlc', d),
          version: '',
          kind: 'dlc',
          runnable: true,
          bytes: 120_000_000 + d * 1_000,
        });
      }
    }
  }

  for (let i = 0; i < options.compressed; i++) {
    const base = titleId(1000 + i, 'base');
    const ext = i % 3 === 0 ? 'nsz' : i % 3 === 1 ? 'xcz' : 'ncz';
    out.push({
      name: `Dump ${i + 1} [${base}][v0].${ext}`,
      titleId: base,
      version: '',
      kind: 'compressed',
      runnable: false,
      reason: 'сжатый образ · сначала «Распаковать» во вкладке Конвертер',
      bytes: 3_100_000_000 + i * 11_000_000,
    });
  }

  for (let i = 0; i < options.split; i++) {
    const base = titleId(2000 + i, 'base');
    for (const part of ['00', '01']) {
      out.push({
        name: `Split Game ${i + 1} [${base}][v0].nsp.${part}`,
        titleId: base,
        version: '',
        kind: 'split',
        runnable: false,
        reason: 'часть разрезанного образа - склеивается с соседними',
        bytes: 2_000_000_000,
      });
    }
  }

  for (let i = 0; i < options.unreadable; i++) {
    const base = titleId(3000 + i, 'base');
    out.push({
      name: `Unknown ${i + 1} [${base}][v0].nsp`,
      titleId: base,
      version: '',
      kind: 'unreadable',
      runnable: false,
      reason: 'ядро не прочитало заголовок · проверьте ключи или распакуйте файл',
      bytes: 400_000_000,
    });
  }

  return out;
}

/** One entry of `fixtures/library.json`, written by tools/make-fixtures.py. */
export interface FixtureFile {
  name: string;
  path: string;
  bytes: number;
  sha256: string;
  format: string;
  kind: 'compressed' | 'unreadable' | 'split';
  reason: string;
  runnable: boolean;
  note?: string;
  converted?: { name: string; bytes: number; sha256: string; format: string };
}

export interface FixtureReport {
  files: FixtureFile[];
  summary: { files: number; bytes: number };
}

/**
 * Fixtures → the shape the page expects.
 *
 * These are the only files in this repo that exist on disk: a real NSP, XCI
 * and NSZ written by `tools/make-fixtures.py`, byte-for-byte what their own
 * `rom_tools.cpp` reads. The page therefore shows real names, real sizes and
 * the honest verdict for a dump without keys — not invented metadata.
 */
export function fixturesToFiles(report: FixtureReport): SymbiosisFile[] {
  return (report.files ?? []).map((f) => ({
    name: f.name,
    developer: `папка Games · ${f.format}`,
    converted: f.converted
      ? { name: f.converted.name, bytes: f.converted.bytes, format: f.converted.format }
      : undefined,
    titleId: (/\[([0-9A-Fa-f]{16})]/.exec(f.name) ?? [])[1] ?? '',
    version: '',
    kind: f.kind,
    runnable: f.runnable,
    reason: f.reason,
    bytes: f.bytes,
  }));
}

export interface LibraryStats {
  files: number;
  games: number;
  updates: number;
  dlc: number;
  compressed: number;
  other: number;
  line: string;
}

export function summarise(files: SymbiosisFile[]): LibraryStats {
  const games = files.filter((f) => f.kind === 'game').length;
  const updates = files.filter((f) => f.kind === 'update').length;
  const dlc = files.filter((f) => f.kind === 'dlc').length;
  const compressed = files.filter((f) => f.kind === 'compressed').length;
  const other = files.length - games - updates - dlc - compressed;
  const plural = (n: number, one: string, few: string, many: string) => {
    const m100 = n % 100;
    const m10 = n % 10;
    if (m100 >= 11 && m100 <= 14) return many;
    if (m10 === 1) return one;
    if (m10 >= 2 && m10 <= 4) return few;
    return many;
  };
  const parts = [
    `${files.length} ${plural(files.length, 'файл', 'файла', 'файлов')}`,
    `${games} ${plural(games, 'игра', 'игры', 'игр')}`,
  ];
  if (updates) parts.push(`${updates} обновл.`);
  if (dlc) parts.push(`${dlc} DLC`);
  if (compressed) {
    parts.push(`${compressed} ${plural(compressed, 'сжатый', 'сжатых', 'сжатых')} → Конвертер`);
  }
  if (other) parts.push(`${other} прочих`);
  return {
    files: files.length,
    games,
    updates,
    dlc,
    compressed,
    other,
    line: parts.join(' · '),
  };
}

/** The JSON the page receives from `Symbiosis.games()`. */
export function gamesJson(files: SymbiosisFile[]) {
  const games = files.map((f, i) => ({
    title: f.name
      .replace(/\[[^\]]*]/g, ' ')
      .replace(/\.[A-Za-z0-9]{2,4}$/, '')
      .replace(/\s+/g, ' ')
      .trim(),
    path: `content://com.android.externalstorage.documents/document/primary%3AGames%2F${encodeURIComponent(f.name)}`,
    programId: f.titleId,
    developer: f.developer ?? (f.kind === 'dlc' ? 'DLC' : ''),
    saveDir: '',
    hasSave: f.kind === 'game' && i % 4 === 0,
    saveBytes: f.kind === 'game' && i % 4 === 0 ? 3_000_000 : 0,
    saveSize: f.kind === 'game' && i % 4 === 0 ? '3 MB' : '',
    addons: [],
    titleId: f.titleId,
    version: f.version,
    fileBytes: f.bytes,
    fileSize: humanSize(f.bytes),
    lastPlayed: f.kind === 'game' && i % 5 === 0 ? Date.now() - i * 86_400_000 : 0,
    lastPlayedLabel: '',
    playSeconds: f.kind === 'game' && i % 5 === 0 ? 3600 + i : 0,
    shaderBytes: 0,
    shaderSize: '',
    fileName: f.name,
    runnable: f.runnable,
    kind: f.kind,
    reason: f.reason ?? '',
  }));
  const stats = summarise(files);
  return JSON.stringify({
    games,
    keys: true,
    runnable: files.filter((f) => f.runnable).length,
    sidecar: files.filter((f) => !f.runnable).length,
    stats: {
      known: true,
      folders: 1,
      files: stats.files,
      games: stats.games,
      updates: stats.updates,
      dlc: stats.dlc,
      compressed: stats.compressed,
      failed: files.filter((f) => f.kind === 'unreadable').length,
      millis: 1840,
      line: stats.line,
    },
  });
}

export function reportJson(files: SymbiosisFile[]) {
  const stats = summarise(files);
  const side = files.filter((f) => !f.runnable);
  const byKind: Record<string, number> = {};
  side.forEach((f) => {
    byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;
  });
  const reasons = Object.entries(
    side.reduce<Record<string, number>>((acc, f) => {
      const key = f.reason ?? 'не открывается';
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([reason, count]) => ({ reason, count }));
  return JSON.stringify({
    stats: {
      known: true,
      folders: 1,
      files: stats.files,
      games: stats.games,
      updates: stats.updates,
      dlc: stats.dlc,
      compressed: stats.compressed,
      failed: files.filter((f) => f.kind === 'unreadable').length,
      millis: 1840,
      line: stats.line,
    },
    byKind,
    reasons,
    files: side.slice(0, 40).map((f) => ({
      name: f.name,
      title: f.name.replace(/\s*\[[^\]]*]/g, ' ').trim(),
      path: '',
      kind: f.kind,
      reason: f.reason ?? '',
    })),
    total: side.length,
    keys: true,
    headline: stats.line,
  });
}

/**
 * The bridge, as a classic script that must run before the page's own.
 *
 * Every call the page makes is recorded, so a check can assert that tapping
 * a compressed file does NOT start an emulator session.
 */
export function buildBridge(files: SymbiosisFile[]) {
  const games = gamesJson(files);
  const report = reportJson(files);
  return `<script>
(function(){
  var CALLS = [];
  function rec(name, payload){
    CALLS.push({ name: name, payload: payload });
    try { window.parent.postMessage({ __symbiosisLab: true, call: name, payload: payload }, '*'); } catch (e) {}
    try { (window.__labCalls || (window.__labCalls = [])).push(name); } catch (e) {}
  }
  window.Symbiosis = {
    bridgeVersion: function(){ return 17; },
    games: function(){ rec('games'); return ${JSON.stringify(games)}; },
    libraryReport: function(){ rec('libraryReport'); return ${JSON.stringify(report)}; },
    status: function(){
      rec('status');
      // Полоса статуса не должна врать: «Игры ✓» при нуле игр — именно то,
      // из-за чего жалоба «ключи и прошивка зелёные, а игр нет» звучала
      // загадкой. Папка и игры - два разных факта и две разные строки.
      var games = ${JSON.stringify(summarise(files).games)};
      return JSON.stringify({ items: [
        { label: 'Ключи', present: true },
        { label: 'Прошивка', present: true },
        { label: 'Папка', present: ${JSON.stringify(files.length)} > 0 },
        { label: 'Игры', present: games > 0 }
      ], dataRoot: '/storage/emulated/0/eden' });
    },
    folders: function(){
      rec('folders');
      // Размер и число файлов - из самих файлов. Раньше здесь стояло
      // '42 GB' строкой, и панель честно печатала выдуманное число.
      return JSON.stringify({ folders: [
        { uri: 'content://tree/games', name: 'Games',
          games: ${JSON.stringify(summarise(files).games)},
          files: ${JSON.stringify(files.length)},
          compressed: ${JSON.stringify(summarise(files).compressed)},
          bytes: ${JSON.stringify(files.reduce((n, f) => n + f.bytes, 0))},
          size: ${JSON.stringify(humanSize(files.reduce((n, f) => n + f.bytes, 0)))},
          skipped: 0, unreadable: false }
      ] });
    },
    memory: function(){ rec('memory'); return JSON.stringify({ leftMb: 2600, usedMb: 5400, budgetMb: 8000, warn: false }); },
    saveSource: function(){ return JSON.stringify({ path: '', titles: 0, name: '', size: '' }); },
    engines: function(){ return JSON.stringify({ current: 'eden', launch: 'eden' }); },
    converterItems: function(){
      rec('converterItems');
      // Настоящий выход конвертера: файл, который make-fixtures.py собрал из
      // NSZ тем же алгоритмом, что rom_tools.cpp. Без ключей ядро и его не
      // прочитает - приложение так и говорит, вместо выдуманного «готово».
      return JSON.stringify({ items: ${JSON.stringify(
        files
          .filter((f) => f.converted)
          .map((f) => ({
            canLaunch: false,
            name: f.converted!.name,
            title: f.converted!.name.replace(/\s*\[[^\]]*]/g, ' ').replace(/\.[a-z0-9]{2,4}$/i, '').trim(),
            path: `content://tree/games/${f.converted!.name}`,
            bytes: f.converted!.bytes,
            size: humanSize(f.converted!.bytes),
            reason: 'ядро не прочитало заголовок · нужны ключи консоли',
            message: 'ядро не прочитало заголовок · нужны ключи консоли',
          })),
      )} });
    },
    icon: function(){ return ''; },
    shot: function(){ return ''; },
    cover: function(){ return ''; },
    launch: function(path, title){ rec('launch', { path: path, title: title }); },
    convertPath: function(path){ rec('convertPath', { path: path }); return JSON.stringify({ busy: true, pending: 1, note: 'в очереди 1' }); },
    pickConvert: function(){ rec('pickConvert'); },
    pickFolder: function(){ rec('pickFolder'); },
    rescan: function(){ rec('rescan'); },
    plugins: function(){ return JSON.stringify({ items: [] }); },
    openEngines: function(){ rec('openEngines'); },
    openUtilities: function(){ rec('openUtilities'); }
  };
  window.__labCalls = [];
})();
</script>`;
}

/**
 * Make `localStorage` usable where the browser refuses it.
 *
 * The page reads `localStorage.getItem('eden-sort')` at the top level, outside
 * any try/catch. Inside a sandboxed iframe — which is exactly how the studio
 * preview and this lab render — that throws a SecurityError and the whole
 * script dies before the first render, producing a white page with no error
 * on screen. The shim has to be in place first.
 */
export const STORAGE_SHIM = `<script>
(function(){
  var ok = true;
  try { window.localStorage.getItem('probe'); } catch (e) { ok = false; }
  if (ok) return;
  var mem = {};
  var fake = {
    getItem: function(k){ return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
    setItem: function(k, v){ mem[k] = String(v); },
    removeItem: function(k){ delete mem[k]; },
    clear: function(){ mem = {}; },
    key: function(i){ return Object.keys(mem)[i] ?? null; },
    get length(){ return Object.keys(mem).length; }
  };
  try { Object.defineProperty(window, 'localStorage', { configurable: true, value: fake }); } catch (e) {}
})();
</script>`;

/** Loads the shipped page into a document string with the bridge in front. */
export function pageWithBridge(html: string, files: SymbiosisFile[], extraShim = '') {
  const inject = `${STORAGE_SHIM}\n${extraShim}\n${buildBridge(files)}`;
  // Before the page's own <script> — the page calls the bridge while parsing.
  const marker = '<script>\n';
  const at = html.lastIndexOf(marker);
  const withBridge = at < 0 ? inject + html : html.slice(0, at) + inject + '\n' + html.slice(at);
  // Аудит добавляется в конец: ему нужны функции страницы, а не наоборот.
  return withBridge.replace('</body>', `${auditFrameScript()}\n</body>`);
}

export interface AuditCheck {
  name: string;
  ok: boolean;
  detail: string;
}

/**
 * Runs inside the iframe. Indirect `eval` in the page's realm sees its global
 * lexical bindings, so `GAMES`, `railGames()` and `visibleGames()` here are
 * the shipped ones, not copies.
 */
export const AUDIT_SCRIPT = `
(function(){
  var out = [];
  function check(name, fn){
    try {
      var r = fn();
      out.push({ name: name, ok: !!r.ok, detail: String(r.detail ?? '') });
    } catch (e) {
      out.push({ name: name, ok: false, detail: 'исключение: ' + (e && e.message ? e.message : e) });
    }
  }
  var expected = window.__labExpected || {};
  var calls = function(){ return window.__labCalls || []; };

  check('страница поднялась и она тёмная', function(){
    var list = document.getElementById('list');
    var style = document.querySelector('style');
    var css = style ? style.textContent : '';
    // No regexp here: an escape inside a template string becomes the
    // escaped character itself, which is what the linter complained about.
    var at = css.indexOf('--bg:');
    var decl = at < 0 ? '' : css.slice(at + 5, css.indexOf(';', at));
    var hex = decl.trim();
    // Белая тема здесь - это ровно то, на что жалуются больше всего.
    var light = /^#(f|e|d)[0-9a-f]{2,5}$/i.test(hex) || /^white$/i.test(hex);
    var painted = getComputedStyle(document.body).backgroundColor;
    return {
      ok: !!list && list.children.length > 0 && !light,
      detail: 'элементов ' + (list ? list.children.length : 0) + ', --bg ' + (hex || 'нет') + ', фон ' + painted
    };
  });

  check('видны все файлы, а не один', function(){
    return { ok: GAMES.length === expected.total, detail: GAMES.length + ' из ' + expected.total };
  });

  check('сжатые файлы в списке, а не выброшены', function(){
    var n = GAMES.filter(function(g){ return g.kind === 'compressed'; }).length;
    return { ok: n === expected.compressed, detail: n + ' сжатых' };
  });

  // v21: карусель обязана отдавать всю библиотеку, иначе одна плитка снова
  // читается как «одна игра». Неработающие файлы в ней есть, но помечены.
  check('карусель отдаёт всю библиотеку, мёртвые помечены', function(){
    var rail = railGames();
    var dead = rail.filter(function(g){ return g.runnable === false; });
    var marked = dead.filter(function(g){ return !!document.querySelector('.slide.dead'); });
    return {
      ok: rail.length === expected.total && (dead.length === 0 || marked.length > 0),
      detail: rail.length + ' из ' + expected.total + ', не запускаются ' + dead.length + ', помечено ' + marked.length
    };
  });

  check('поиск не режет карусель (v21)', function(){
    var q = document.getElementById('q');
    if (!q) return { ok: true, detail: 'нет поля поиска' };
    var before = railGames().length;
    q.value = 'zzz-no-such-game';
    var after = railGames().length;
    q.value = '';
    return { ok: after === before, detail: before + ' -> ' + after };
  });

  check('фильтр «Не запускается» показывает ровно их', function(){
    var saved = FILTER;
    FILTER = 'dead';
    var dead = visibleGames();
    FILTER = saved;
    var bad = dead.filter(function(g){ return g.runnable !== false; });
    return { ok: bad.length === 0 && dead.length === expected.notRunnable, detail: dead.length + ' из ' + expected.notRunnable };
  });

  check('сводка пишет, сколько сжатых', function(){
    var el = document.getElementById('stat-line');
    var txt = el ? el.textContent : '';
    return { ok: txt.indexOf(String(expected.compressed)) >= 0, detail: JSON.stringify(txt.slice(0, 120)) };
  });

  check('«почему?» открывает разбор, а не пустоту', function(){
    if (typeof whyNot !== 'function') return { ok: false, detail: 'нет функции почему' };
    whyNot();
    var body = document.getElementById('why-body');
    var open = document.getElementById('why').classList.contains('on');
    var n = body ? body.children.length : 0;
    document.getElementById('why').classList.remove('on');
    return { ok: open && n > 0, detail: 'открыт ' + open + ', строк ' + n };
  });

  check('тап по сжатому не запускает сессию', function(){
    var g = GAMES.filter(function(x){ return x.kind === 'compressed'; })[0];
    if (!g) return { ok: true, detail: 'нет сжатых' };
    var before = calls().filter(function(c){ return c === 'launch'; }).length;
    if (typeof deadAction === 'function') deadAction(g);
    var close = document.getElementById('a-close');
    if (close) close.click();
    var after = calls().filter(function(c){ return c === 'launch'; }).length;
    return { ok: after === before, detail: 'launch: ' + before + ' -> ' + after };
  });

  check('у сжатого есть кнопка «Распаковать»', function(){
    var g = GAMES.filter(function(x){ return x.kind === 'compressed'; })[0];
    if (!g) return { ok: true, detail: 'нет сжатых' };
    deadAction(g);
    var conv = document.getElementById('a-conv');
    var has = !!conv;
    if (conv) conv.click();
    var pulled = calls().filter(function(c){ return c === 'convertPath'; }).length;
    return { ok: has && pulled > 0, detail: 'кнопка ' + has + ', вызовов convertPath ' + pulled };
  });

  check('запускаемая игра запускается', function(){
    // Библиотека из одних сжатых образов - законное состояние: запускать
    // нечего, и карусель обязана быть пустой, а не полной нерабочих плиток.
    if (!expected.runnable) {
      return {
        ok: railGames().every(function(g){ return g.runnable === false; }),
        detail: 'запускаемых нет, плиток ' + railGames().length
      };
    }
    var g = railGames().filter(function(x){ return x.runnable !== false; })[0];
    if (!g) return { ok: false, detail: 'карусель пуста' };
    var before = calls().filter(function(c){ return c === 'launch'; }).length;
    play(g);
    var after = calls().filter(function(c){ return c === 'launch'; }).length;
    return { ok: after > before, detail: 'launch: ' + before + ' -> ' + after };
  });

  check('обновления и DLC не выдают себя за игры', function(){
    var dlc = GAMES.filter(function(g){ return g.kind === 'dlc'; }).length;
    var upd = GAMES.filter(function(g){ return g.kind === 'update'; }).length;
    return { ok: dlc === expected.dlc && upd === expected.updates, detail: 'dlc ' + dlc + '/' + expected.dlc + ', обновлений ' + upd + '/' + expected.updates };
  });

  check('ни одна строка не пустая', function(){
    var nameless = GAMES.filter(function(g){ return !(g.title || g.fileName); });
    return { ok: nameless.length === 0, detail: nameless.length + ' без имени' };
  });

  return JSON.stringify(out);
})();
`;

/**
 * Аудит, который исполняется внутри страницы и отвечает через postMessage.
 *
 * Почему не `frame.contentWindow.eval`: iframe в студии песочный
 * (`sandbox="allow-scripts"` без `allow-same-origin`), у него непрозрачный
 * origin, и родитель не имеет права даже читать его window — попытка падает
 * с «Blocked a frame from accessing a cross-origin frame». Раньше проверки
 * поэтому работали только в JSDOM, а в браузере кнопка молча ничего не
 * делала (скриншот это и показал).
 *
 * Здесь наоборот: скрипт кладётся в документ, слушает сообщение и отвечает
 * тем же каналом. Песочница остаётся строгой.
 */
export function auditFrameScript(): string {
  // Текст аудита кладётся в документ как строка в двойных кавычках,
  // собранная JSON.stringify: он экранирует всё, что могло бы закрыть
  // шаблон, и не требует ручной возни с бэкслешами.
  const auditLiteral = JSON.stringify(AUDIT_SCRIPT);
  return `<script>
var AUDIT = ${auditLiteral};
(function(){
  function run(expected){
    window.__labExpected = expected;
    try {
      if (typeof GAMES === 'undefined') {
        return [{ name: 'страница поднялась', ok: false, detail: 'скрипт страницы не выполнился' }];
      }
      return JSON.parse(eval(AUDIT));
    } catch (e) {
      return [{ name: 'проверки', ok: false, detail: 'исключение: ' + (e && e.message) }];
    }
  }
  window.__runLabAudit = run;
  window.addEventListener('message', function(ev){
    var d = ev.data || {};
    if (d.__lab !== 'run') return;
    var results = run(d.expected || {});
    try {
      window.parent.postMessage({ __lab: 'result', results: results }, '*');
    } catch (e) {}
  });
})();
</script>`;
}

export const AUDIT_HELP = `Symbiosis Lab loads the emulator's real library page in an iframe with a
synthetic bridge: 24 games, 24 updates, 16 DLC, 180 compressed dumps, 3 files
whose header cannot be read, 2 split images (4 parts). It then runs 13 checks
against the shipped functions — GAMES, railGames(), visibleGames(), whyNot(),
deadAction() — and reports what the page does, not what the source says.

The three that matter:
  * every file visible, not one;
  * compressed files present and pointing at the converter;
  * tapping a compressed file never starts a session.`;
