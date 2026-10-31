import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FlaskConical, Play, RefreshCw, RotateCcw } from 'lucide-react';
import { useStudio } from '../lib/studio';
import {
  AUDIT_SCRIPT,
  DEFAULT_LIBRARY,
  buildLibrary,
  pageWithBridge,
  summarise,
  type LibraryOptions,
  type SymbiosisFile,
} from '../lib/symbiosis';

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

const PRESETS: { id: string; label: string; options: LibraryOptions }[] = [
  { id: 'normal', label: '24 игры', options: DEFAULT_LIBRARY },
  {
    id: 'dump',
    label: '600 файлов',
    options: { games: 120, compressed: 400, unreadable: 6, split: 8, noStorage: true },
  },
  {
    id: 'one',
    label: 'сжатые без игр',
    options: { games: 0, compressed: 250, unreadable: 0, split: 0, noStorage: true },
  },
];

export function SymbiosisLab() {
  const { pushTerminal } = useStudio();
  const [preset, setPreset] = useState('normal');
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [running, setRunning] = useState(false);
  const [nonce, setNonce] = useState(0);
  const frame = useRef<HTMLIFrameElement | null>(null);

  const options = useMemo(
    () => PRESETS.find((p) => p.id === preset)?.options ?? DEFAULT_LIBRARY,
    [preset],
  );
  const files: SymbiosisFile[] = useMemo(() => buildLibrary(options), [options]);
  const stats = useMemo(() => summarise(files), [files]);

  useEffect(() => {
    let alive = true;
    const url = `${import.meta.env.BASE_URL}symbiosis/library.html`;
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((text) => {
        if (alive) setHtml(text);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  const doc = useMemo(() => (html ? pageWithBridge(html, files) : ''), [html, files]);

  const runAudit = useCallback(() => {
    const win = frame.current?.contentWindow;
    if (!win) return;
    setRunning(true);
    try {
      const expected = {
        total: stats.files,
        compressed: stats.compressed,
        runnable: files.filter((f) => f.runnable).length,
        notRunnable: files.filter((f) => !f.runnable).length,
        dlc: stats.dlc,
        updates: stats.updates,
      };
      // Indirect eval in the page's realm: GAMES / railGames() / whyNot() here
      // are the shipped ones, not copies made by the test.
      // `Window` in lib.dom has no `eval`; the value is a function in the
      // iframe's realm, which is exactly what we need.
      const runEval = (win as unknown as { eval: (src: string) => unknown }).eval;
      const raw = runEval.call(
        win,
        `window.__labExpected = ${JSON.stringify(expected)}; ${AUDIT_SCRIPT}`,
      );
      const parsed = JSON.parse(String(raw)) as Check[];
      setChecks(parsed);
      const failed = parsed.filter((c) => !c.ok);
      pushTerminal(
        `symbiosis-lab: ${parsed.length - failed.length}/${parsed.length} проверок прошло`,
        failed.length ? 'err' : 'ok',
      );
      failed.forEach((c) => pushTerminal(`  FAIL ${c.name} — ${c.detail}`, 'err'));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setChecks([{ name: 'запуск проверок', ok: false, detail: msg }]);
      pushTerminal(`symbiosis-lab: проверки не запустились — ${msg}`, 'err');
    } finally {
      setRunning(false);
    }
  }, [files, pushTerminal, stats]);

  const passed = checks?.filter((c) => c.ok).length ?? 0;
  const failed = checks ? checks.length - passed : 0;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--bg-1)]">
      <div className="border-b border-[var(--border)] px-3 py-2">
        <div className="flex items-center gap-2">
          <FlaskConical size={15} className="text-[var(--accent)]" />
          <span className="text-[12.5px] font-medium">Symbiosis Lab</span>
          <span className="ml-auto text-[11px] text-[var(--muted)]">
            {stats.files} файлов · {stats.games} игр · {stats.compressed} сжатых
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                setPreset(p.id);
                setChecks(null);
              }}
              className={`rounded-md px-2 py-1 text-[11px] ${
                preset === p.id
                  ? 'bg-[var(--accent)]/15 text-[var(--accent)]'
                  : 'text-[var(--muted)] hover:text-[var(--text)]'
              }`}
            >
              {p.label}
            </button>
          ))}
          <button
            onClick={() => {
              setNonce((n) => n + 1);
              setChecks(null);
            }}
            className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-[var(--muted)] hover:text-[var(--text)]"
            title="Перезагрузить страницу"
          >
            <RotateCcw size={12} /> сброс
          </button>
          <button
            onClick={runAudit}
            disabled={!html || running}
            className="flex items-center gap-1 rounded-md bg-[var(--accent)]/15 px-2 py-1 text-[11px] text-[var(--accent)] disabled:opacity-40"
          >
            {running ? <RefreshCw size={12} className="animate-spin" /> : <Play size={12} />}
            проверить
          </button>
        </div>
      </div>

      {checks && (
        <div className="max-h-[38%] overflow-auto border-b border-[var(--border)] px-3 py-2">
          <div className="mb-1 flex items-center gap-2 text-[11.5px]">
            <span className={failed ? 'text-[var(--err)]' : 'text-[var(--ok)]'}>
              {passed}/{checks.length} прошло
            </span>
            {failed > 0 && (
              <span className="flex items-center gap-1 text-[var(--err)]">
                <AlertTriangle size={12} /> {failed} провалено
              </span>
            )}
          </div>
          {checks.map((c) => (
            <div key={c.name} className="flex items-start gap-1.5 py-0.5 text-[11.5px]">
              {c.ok ? (
                <CheckCircle2 size={12} className="mt-0.5 shrink-0 text-[var(--ok)]" />
              ) : (
                <AlertTriangle size={12} className="mt-0.5 shrink-0 text-[var(--err)]" />
              )}
              <span className={c.ok ? 'text-[var(--text)]' : 'text-[var(--err)]'}>{c.name}</span>
              <span className="ml-auto max-w-[48%] truncate text-right text-[var(--muted)]" title={c.detail}>
                {c.detail}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="relative min-h-0 flex-1 bg-black/40 p-2">
        {error && (
          <div className="rounded-lg border border-[var(--err)]/40 bg-[var(--err)]/10 p-3 text-[12px] text-[var(--err)]">
            Страница не загрузилась: {error}
            <div className="mt-1 text-[11px] text-[var(--muted)]">
              нужен файл <code>public/symbiosis/library.html</code> — он кладётся скриптом{' '}
              <code>tools/sync-symbiosis.sh</code>.
            </div>
          </div>
        )}
        {!html && !error && (
          <div className="grid h-full place-items-center text-[12px] text-[var(--muted)]">загрузка страницы…</div>
        )}
        {html && (
          <iframe
            key={`${preset}-${nonce}`}
            ref={frame}
            title="Symbiosis library"
            srcDoc={doc}
            onLoad={() => setChecks(null)}
            className="h-full w-full rounded-lg border border-[var(--border)] bg-[#0b0d12]"
            sandbox="allow-scripts"
          />
        )}
      </div>
    </div>
  );
}
