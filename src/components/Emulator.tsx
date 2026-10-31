import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  CheckCircle2,
  ExternalLink,
  FileUp,
  Home,
  Package,
  RotateCw,
  ShieldAlert,
  Smartphone,
  Trash2,
  Zap,
} from 'lucide-react';
import { useStudio } from '../lib/studio';
import { extractApkAssets } from '../lib/apk';

const BRIDGE_SHIM = `<script>(function(){
  function send(method, payload){
    try { window.parent.postMessage({ __apkforge: true, method: method, payload: payload }, '*'); } catch (e) {}
  }
  window.Android = {
    showToast: function (m) { send('showToast', m); },
    log: function (m) { send('log', m); },
    vibrate: function (ms) { send('vibrate', ms); },
    finish: function () { send('finish', ''); },
    deviceInfo: function () { return 'APKForge Studio Device (API 34)'; },
    setTitle: function (t) { send('setTitle', t); },
    getPackageName: function () { send('getPackageName', ''); }
  };
})();</script>`;

function inlineAssets(html: string, assets: Record<string, string>): string {
  let out = html.replace(/<link[^>]*href=["']([^"']+)["'][^>]*>/g, (match, href: string) => {
    const clean = href.replace(/^\.\//, '');
    const css = assets[clean] ?? assets[href];
    return css ? `<style>\n${css}\n</style>` : match;
  });
  out = out.replace(/<script[^>]*src=["']([^"']+)["'][^>]*><\/script>/g, (match, src: string) => {
    const clean = src.replace(/^\.\//, '');
    const js = assets[clean] ?? assets[src];
    return js ? `<script>\n${js}\n</script>` : match;
  });
  return out;
}

interface LogEntry {
  id: number;
  tag: string;
  text: string;
  level: 'I' | 'W' | 'E';
}

export function Emulator() {
  const { apps, installApk, installExternalApkFile, uninstallApp, buildArtifacts, config, pushTerminal } = useStudio();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dismissedHome, setDismissedHome] = useState(false);
  const [frameState, setFrameState] = useState<{ appId: string; url: string | null }>({ appId: '', url: null });
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [clock, setClock] = useState(() => new Date());
  const [rotated, setRotated] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const logId = useRef(0);

  const activeApp = useMemo(() => {
    if (dismissedHome && !selectedId) return undefined;
    if (selectedId) return apps.find((a) => a.id === selectedId) ?? apps[0];
    return apps[0];
  }, [apps, dismissedHome, selectedId]);

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 10000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!activeApp) return;
    let revokedUrl: string | null = null;
    let revokeMedia: (() => void) | null = null;
    let cancelled = false;

    void extractApkAssets(activeApp.blob).then(({ text, mediaUrls, revokeAll }) => {
      if (cancelled) {
        revokeAll();
        return;
      }
      revokeMedia = revokeAll;
      const html = text['index.html'];
      if (!html) {
        setFrameState({ appId: activeApp.id, url: null });
        return;
      }
      const mediaScript = `<script>window.__APKFORGE_MEDIA__ = ${JSON.stringify(mediaUrls)};</script>`;
      const inlined = inlineAssets(html, text);
      const withBridge = inlined.includes('<head>')
        ? inlined.replace('<head>', `<head>${mediaScript}${BRIDGE_SHIM}`)
        : mediaScript + BRIDGE_SHIM + inlined;
      revokedUrl = URL.createObjectURL(new Blob([withBridge], { type: 'text/html' }));
      setFrameState({ appId: activeApp.id, url: revokedUrl });
    });

    return () => {
      cancelled = true;
      if (revokedUrl) URL.revokeObjectURL(revokedUrl);
      if (revokeMedia) revokeMedia();
    };
  }, [activeApp]);

  const activeFrameUrl = activeApp && frameState.appId === activeApp.id ? frameState.url : null;

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { __apkforge?: boolean; method?: string; payload?: unknown } | null;
      if (!data || !data.__apkforge) return;
      logId.current += 1;
      const entry: LogEntry = {
        id: logId.current,
        tag: 'ForgeDeck',
        text: String(data.payload ?? ''),
        level: 'I',
      };
      if (data.method === 'showToast') {
        setToast(String(data.payload));
        setTimeout(() => setToast(null), 2200);
        entry.text = `Toast: ${String(data.payload)}`;
      }
      if (data.method === 'finish') {
        setSelectedId(null);
        setDismissedHome(true);
      }
      setLogs((prev) => [entry, ...prev].slice(0, 120));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const appendLog = (tag: string, text: string, level: 'I' | 'W' | 'E' = 'I') => {
    logId.current += 1;
    setLogs((prev) => [{ id: logId.current, tag, text, level }, ...prev].slice(0, 120));
  };

  const handleFile = async (file: File) => {
    try {
      const inspected = await installExternalApkFile(file);
      setDismissedHome(false);
      setSelectedId(null);
      appendLog(
        'PackageManager',
        `Installed ${inspected.packageName} v${inspected.versionName} (${inspected.entries.length} entries, v2=${inspected.verification.v2SignatureVerified})`,
        'I',
      );
      pushTerminal(
        `Loaded APK ${file.name}: package=${inspected.packageName} v${inspected.versionName} · v1=${inspected.verification.hasV1Signature} · v2=${inspected.verification.v2SignatureVerified}`,
        'ok',
      );
    } catch (error) {
      const msg = (error as Error).message;
      appendLog('PackageManager', `Install failed: ${msg}`, 'E');
      pushTerminal(`emulator: failed to open ${file.name}: ${msg}`, 'err');
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--bg-1)]">
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2">
        <Smartphone size={14} className="text-[var(--accent)]" />
        <select
          value={activeApp?.id ?? ''}
          onChange={(e) => {
            const val = e.target.value;
            if (!val) {
              setSelectedId(null);
              setDismissedHome(true);
            } else {
              setDismissedHome(false);
              setSelectedId(val);
            }
          }}
          className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--bg-2)] px-2 py-1 text-[11.5px] text-[var(--text)] outline-none"
        >
          <option value="">Home screen (no app focused)</option>
          {apps.map((app) => (
            <option key={app.id} value={app.id}>
              {app.name} · {app.packageName}
            </option>
          ))}
        </select>
        <button onClick={() => setRotated((v) => !v)} className="icon-btn" title="Rotate">
          <RotateCw size={13} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="flex justify-center">
          <div
            className={`relative rounded-[34px] border border-[#2a3441] bg-[#05070a] p-2 shadow-[0_24px_60px_rgba(0,0,0,0.55)] transition-transform ${
              rotated ? 'rotate-90' : ''
            }`}
            style={{ width: rotated ? 300 : 268 }}
          >
            <div className="pointer-events-none absolute left-1/2 top-3 z-10 h-5 w-16 -translate-x-1/2 rounded-full bg-[#05070a]" />
            <div className="relative overflow-hidden rounded-[26px] bg-[#05070a]">
              <div className="flex h-7 items-center justify-between bg-[#05070a] px-4 text-[10px] font-medium text-[#cfd8e3]">
                <span>{clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                <span className="flex items-center gap-1.5">
                  <span className="flex items-end gap-[2px]">
                    {[3, 5, 7, 9].map((h) => (
                      <span key={h} className="w-[2px] rounded-sm bg-[#cfd8e3]" style={{ height: h }} />
                    ))}
                  </span>
                  <span className="rounded-[3px] border border-[#cfd8e3] px-1 py-[1px] text-[8px]">86%</span>
                </span>
              </div>

              <div className="relative h-[470px] w-full bg-[#0b0f14]">
                {activeFrameUrl ? (
                  <iframe
                    src={activeFrameUrl}
                    title="app"
                    className="h-full w-full border-0"
                    sandbox="allow-scripts allow-same-origin allow-modals"
                  />
                ) : activeApp && !activeApp.hasWebPayload ? (
                  <div className="flex h-full flex-col justify-center gap-3 px-5 text-left">
                    <div className="flex items-center gap-2.5">
                      <div className="grid h-10 w-10 place-items-center rounded-xl border border-[var(--border)] bg-[var(--bg-2)]">
                        <Package size={18} className="text-[var(--accent)]" />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-[12.5px] font-semibold text-[var(--text)]">{activeApp.name}</div>
                        <div className="truncate font-mono text-[10px] text-[var(--muted)]">{activeApp.packageName}</div>
                      </div>
                    </div>
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-2)] p-3 font-mono text-[10.5px] leading-relaxed text-[var(--muted)]">
                      <div>version: {activeApp.version}</div>
                      <div>entries: {activeApp.entriesCount}</div>
                      <div>zipalign (4B): {activeApp.zipAligned ? 'OK' : 'NO'}</div>
                      <div>JAR v1 sig: {activeApp.signedV1 ? 'present' : 'none'}</div>
                      <div>APK v2 sig: {activeApp.signedV2 ? 'verified' : 'none'}</div>
                    </div>
                    <p className="text-[11px] leading-relaxed text-[var(--muted)]">
                      Native Dalvik/ART APK inspected. Run on a full Android device via <span className="font-mono">adb install</span> or cloud AVD.
                    </p>
                  </div>
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
                    <div className="grid h-14 w-14 place-items-center rounded-2xl border border-[var(--border)] bg-[var(--bg-2)]">
                      <Package size={22} className="text-[var(--muted)]" />
                    </div>
                    <p className="text-[12px] leading-relaxed text-[var(--muted)]">
                      {apps.length
                        ? 'Select an installed app above to launch it.'
                        : 'Build an APK or click Open APK… to inspect and run it here.'}
                    </p>
                  </div>
                )}

                <AnimatePresence>
                  {toast && (
                    <motion.div
                      initial={{ opacity: 0, y: -12, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -8 }}
                      className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-lg bg-[#20262f] px-3 py-2 text-[11px] text-[#e6edf3] shadow-lg"
                    >
                      {toast}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <div className="flex h-9 items-center justify-center gap-16 bg-[#05070a]">
                <button
                  onClick={() => {
                    setSelectedId(null);
                    setDismissedHome(true);
                  }}
                  className="text-[#6f7d90] hover:text-[#cfd8e3]"
                  title="Back"
                >
                  <span className="block h-[3px] w-4 rounded-full bg-current" />
                </button>
                <button
                  onClick={() => {
                    setSelectedId(null);
                    setDismissedHome(true);
                  }}
                  className="grid h-5 w-5 place-items-center rounded-full border border-current text-[10px] text-[#6f7d90] hover:text-[#cfd8e3]"
                  title="Home"
                >
                  <Home size={10} />
                </button>
                <button
                  onClick={() => setDismissedHome(false)}
                  className="text-[#6f7d90] hover:text-[#cfd8e3]"
                  title="Recents"
                >
                  <span className="block h-[3px] w-4 rounded-full bg-current opacity-60" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            onClick={() => {
              const latest = buildArtifacts[buildArtifacts.length - 1];
              if (latest) {
                setDismissedHome(false);
                void installApk(latest);
              }
            }}
            disabled={!buildArtifacts.length}
            className="flex items-center justify-center gap-1.5 rounded-lg bg-[var(--accent)] px-2 py-2 text-[11.5px] font-semibold text-[#06210f] disabled:opacity-40"
          >
            <Zap size={13} /> Install APK
          </button>
          <button
            onClick={() => fileInput.current?.click()}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-2)] px-2 py-2 text-[11.5px] text-[var(--text)]"
          >
            <FileUp size={13} /> Open APK…
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".apk"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
              e.target.value = '';
            }}
          />
          <button
            onClick={() => window.open('https://appetizer.io/upload', '_blank', 'noopener')}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-2)] px-2 py-2 text-[11.5px] text-[var(--text)]"
          >
            <ExternalLink size={13} /> appetizer.io
          </button>
          <button
            onClick={() => {
              if (activeApp) uninstallApp(activeApp.id);
              setSelectedId(null);
            }}
            disabled={!activeApp}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-2)] px-2 py-2 text-[11.5px] text-[var(--muted)] disabled:opacity-40"
          >
            <Trash2 size={13} /> Uninstall
          </button>
        </div>

        <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--bg-2)] p-2.5 text-[11px] text-[var(--muted)]">
          <div className="mb-1 flex items-center gap-1.5 font-semibold uppercase tracking-[0.12em] text-[var(--text)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" /> Package & Signature
          </div>
          <div className="font-mono leading-relaxed">
            {activeApp ? (
              <>
                <div>app: {activeApp.packageName} (v{activeApp.version})</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px]">
                  <span className={activeApp.signedV2 ? 'flex items-center gap-1 text-[var(--accent)]' : 'flex items-center gap-1 text-[var(--warn)]'}>
                    {activeApp.signedV2 ? <CheckCircle2 size={11} /> : <ShieldAlert size={11} />}
                    {activeApp.signedV2 ? 'v1 + v2 verified' : activeApp.signedV1 ? 'v1 signed' : 'unsigned'}
                  </span>
                  <span>· zipalign: {activeApp.zipAligned ? '4B OK' : 'unaligned'}</span>
                </div>
              </>
            ) : (
              <div>{config.applicationId} · not installed</div>
            )}
          </div>
        </div>

        <div className="mt-3 rounded-lg border border-[var(--border)] bg-[#070a0e]">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-2.5 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
            <span>logcat</span>
            <button
              onClick={() => setLogs([])}
              className="text-[10px] normal-case tracking-normal hover:text-[var(--text)]"
            >
              clear
            </button>
          </div>
          <div className="max-h-40 overflow-y-auto px-2.5 py-1.5 font-mono text-[10.5px] leading-relaxed">
            {logs.length === 0 && <div className="text-[var(--muted)] opacity-60">— no output —</div>}
            {logs.map((log) => (
              <div key={log.id} className="flex gap-1.5">
                <span
                  className={
                    log.level === 'E'
                      ? 'text-[var(--err)]'
                      : log.level === 'W'
                        ? 'text-[var(--warn)]'
                        : 'text-[var(--accent)]'
                  }
                >
                  {log.level}
                </span>
                <span className="text-[#7dcfff]">{log.tag}</span>
                <span className="text-[var(--muted)]">{log.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
