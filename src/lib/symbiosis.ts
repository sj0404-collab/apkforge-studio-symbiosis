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
      version: '0.0.0',
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
      version: '0.0.0',
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
        version: '0.0.0',
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
  const parts = [`${files.length} файлов`, `${games} ${plural(games, 'игра', 'игры', 'игр')}`];
  if (updates) parts.push(`${updates} обновл.`);
  if (dlc) parts.push(`${dlc} DLC`);
  if (compressed) parts.push(`${compressed} сжатых → Конвертер`);
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
    title: f.name.replace(/\s*\[[^\]]*]/g, ' ').replace(/\s+/g, ' ').trim(),
    path: `content://com.android.externalstorage.documents/document/primary%3AGames%2F${encodeURIComponent(f.name)}`,
    programId: f.titleId,
    developer: f.kind === 'dlc' ? 'DLC' : 'Symbiosis Lab',
    saveDir: '',
    hasSave: f.kind === 'game' && i % 4 === 0,
    saveBytes: f.kind === 'game' && i % 4 === 0 ? 3_000_000 : 0,
    saveSize: f.kind === 'game' && i % 4 === 0 ? '3 MB' : '',
    addons: [],
    titleId: f.titleId,
    version: f.version,
    fileBytes: f.bytes,
    fileSize: `${(f.bytes / 1e9).toFixed(1)} GB`,
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
      return JSON.stringify({ items: [
        { label: 'Ключи', present: true }, { label: 'Прошивка', present: true },
        { label: 'Игры', present: true }
      ], dataRoot: '/storage/emulated/0/eden' });
    },
    folders: function(){
      rec('folders');
      return JSON.stringify({ folders: [
        { uri: 'content://tree/games', name: 'Games', games: ${JSON.stringify(
          summarise(files).games,
        )}, bytes: ${JSON.stringify(files.reduce((n, f) => n + f.bytes, 0))}, size: '42 GB', skipped: 0, unreadable: false, compressed: ${JSON.stringify(
          summarise(files).compressed,
        )} }
      ] });
    },
    memory: function(){ rec('memory'); return JSON.stringify({ leftMb: 2600, usedMb: 5400, budgetMb: 8000, warn: false }); },
    saveSource: function(){ return JSON.stringify({ path: '', titles: 0, name: '', size: '' }); },
    engines: function(){ return JSON.stringify({ current: 'eden', launch: 'eden' }); },
    converterItems: function(){ rec('converterItems'); return JSON.stringify({ items: [] }); },
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
  if (at < 0) return inject + html;
  return html.slice(0, at) + inject + '\n' + html.slice(at);
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

export const AUDIT_HELP = `Symbiosis Lab loads the emulator's real library page in an iframe with a
synthetic bridge: 24 games, 24 updates, 16 DLC, 180 compressed dumps, 3 files
whose header cannot be read, 2 split images (4 parts). It then runs 13 checks
against the shipped functions — GAMES, railGames(), visibleGames(), whyNot(),
deadAction() — and reports what the page does, not what the source says.

The three that matter:
  * every file visible, not one;
  * compressed files present and pointing at the converter;
  * tapping a compressed file never starts a session.`;
