/**
 * Applies the centralized design configuration to a subtree.
 *   <DesignProvider system="payment-kiosk"> … <div data-el="payment-kiosk/summary/amount/total"/> … </DesignProvider>
 * Listens for `design:updated` pushes and re-applies without reload, then acks
 * the version so admins can see which clients received it.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  buildSystemCss,
  ELEMENTS,
  googleFontsUrl,
  normalizeDesign,
  uploadedFontFaces,
  type DesignConfig,
  type SystemId,
} from '@pp/shared/design/index';
import { get } from '../lib/api';
import { connectSocket } from '../lib/socket';

interface DesignState {
  config: DesignConfig;
  version: number | null;
  system: SystemId;
}

const Ctx = createContext<DesignState | null>(null);
export const useDesign = () => useContext(Ctx);

let shared: Promise<{ design: DesignConfig; version: number | null }> | null = null;
function loadDesign(force = false) {
  if (!shared || force) {
    shared = get<{ design: DesignConfig; designVersion?: number }>('/api/public/config').then((r) => ({
      design: normalizeDesign(r.design),
      version: r.designVersion ?? null,
    }));
  }
  return shared;
}

const clientId = (() => {
  try {
    const k = 'pp.clientId';
    let v = localStorage.getItem(k);
    if (!v) localStorage.setItem(k, (v = crypto.randomUUID?.() ?? String(Math.random()).slice(2)));
    return v;
  } catch {
    return 'anon-' + Math.random().toString(36).slice(2);
  }
})();

function useFontLinks(cfg: DesignConfig | null, suffix = '') {
  useEffect(() => {
    if (!cfg) return;
    const url = googleFontsUrl(cfg);
    let link = document.getElementById('pp-google-fonts' + suffix) as HTMLLinkElement | null;
    if (url) {
      if (!link) {
        link = document.createElement('link');
        link.id = 'pp-google-fonts' + suffix;
        link.rel = 'stylesheet';
        document.head.appendChild(link);
      }
      if (link.href !== url) link.href = url;
    }
    let faces = document.getElementById('pp-font-faces' + suffix) as HTMLStyleElement | null;
    if (!faces) {
      faces = document.createElement('style');
      faces.id = 'pp-font-faces' + suffix;
      document.head.appendChild(faces);
    }
    faces.textContent = uploadedFontFaces(cfg);
  }, [cfg]);
}

export function SystemStyle({ config, system, preview }: { config: DesignConfig; system: SystemId; preview?: boolean }) {
  const css = useMemo(() => {
    const out = buildSystemCss(config, system, ELEMENTS);
    // Draft previews are scoped so they don't restyle the surrounding admin shell.
    return preview ? out.replace(new RegExp(`\\[data-system="${system}"\\]`, 'g'), `[data-preview][data-system="${system}"]`) : out;
  }, [config, system, preview]);
  useFontLinks(config, preview ? '-preview' : '');
  return <style data-design-system={system}>{css}</style>;
}

export function DesignProvider({
  system,
  children,
  config: override,
  className,
  live = true,
}: {
  system: SystemId;
  children: ReactNode;
  /** Preview a draft config (editor) instead of the published one. */
  config?: DesignConfig;
  className?: string;
  live?: boolean;
}) {
  const [state, setState] = useState<{ design: DesignConfig; version: number | null } | null>(null);

  useEffect(() => {
    if (override) return;
    let alive = true;
    loadDesign().then((d) => alive && setState(d)).catch(() => alive && setState({ design: normalizeDesign(null), version: null }));
    if (!live) return () => void (alive = false);
    const sock = connectSocket({ system });
    sock.on('design:updated', async (p: { versionId?: number; versionNo?: number }) => {
      const d = await loadDesign(true);
      if (!alive) return;
      setState(d);
      sock.emit('config:ack', { versionId: p.versionId ?? d.version, system, clientId });
    });
    return () => {
      alive = false;
      sock.disconnect();
    };
  }, [system, override, live]);

  const cfg = override ?? state?.design ?? null;
  if (!cfg) return <div data-system={system} className={`sys-root ${className ?? ''}`} />;
  const theme = (cfg.systems[system]?.tokens?.theme ?? cfg.global.tokens.theme) || 'light';
  return (
    <Ctx.Provider value={{ config: cfg, version: state?.version ?? null, system }}>
      <SystemStyle config={cfg} system={system} preview={!!override} />
      <div data-system={system} data-preview={override ? '' : undefined} data-theme={theme} className={`sys-root ${className ?? ''}`}>
        {children}
      </div>
    </Ctx.Provider>
  );
}
