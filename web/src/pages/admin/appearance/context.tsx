/**
 * Shared state for Admin → Appearance: the published design config, its
 * version, publish helpers and the caller's permissions.
 */
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { SYSTEMS, type DesignConfig, type DesignTokens, type FontRole, type SystemId, type TypographyStyle } from '@pp/shared/design/index';
import { get, post } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { useAsync } from '../../../components/ui';

export interface VersionInfo {
  id: number | null;
  versionNo: number;
  createdAt: string | null;
  createdBy: string | null;
}

export interface PrintSettings {
  ticket: {
    paperWidth: '58' | '80';
    title: string;
    subtitle: string;
    logoUrl: string;
    showProvince: boolean;
    showFreeTime: boolean;
    showRate: boolean;
    footerText: string;
    qrCount: number;
    qrSize: number;
    fontScale: number;
    extraLines: string[];
  };
  receipt: {
    paperWidth: '58' | '80';
    header: string;
    footer: string;
    showVat: boolean;
    companyName: string;
    companyTaxId: string;
    companyAddress: string;
    vatRate: number;
    promoText: string;
  };
}

export interface DesignResponse {
  config: DesignConfig;
  version: VersionInfo;
  systems: Array<{ id: SystemId; name: string; group?: string }>;
  groups: Record<string, { label: string; systems: SystemId[] }>;
  branding: { siteName: string; logoUrl: string };
  print: PrintSettings;
}

export interface PublishResult {
  version: VersionInfo;
  changedSystems: SystemId[];
  changes: number;
}

export type DesignPatch = { fonts?: Partial<Record<FontRole, string>>; tokens?: Partial<DesignTokens>; text?: Partial<TypographyStyle> };

interface Ctx {
  data: DesignResponse;
  reload: () => Promise<void>;
  publish: (config: DesignConfig, appliedTo?: SystemId[], note?: string) => Promise<PublishResult>;
  applyPatch: (patch: DesignPatch, systems: SystemId[], note?: string) => Promise<PublishResult>;
  perms: {
    edit: boolean;
    apply: boolean;
    applyAll: boolean;
    rollback: boolean;
    upload: boolean;
    google: boolean;
  };
}

const AppearanceCtx = createContext<Ctx | null>(null);

export function useAppearance() {
  const c = useContext(AppearanceCtx);
  if (!c) throw new Error('useAppearance outside AppearanceProvider');
  return c;
}

export function AppearanceProvider({ children, fallback }: { children: ReactNode; fallback: (s: { loading: boolean; error: string | null }) => ReactNode }) {
  const { can } = useAuth();
  const { data, error, loading, reload } = useAsync(() => get<DesignResponse>('/api/appearance/design'), []);
  const publish = useCallback(
    async (config: DesignConfig, appliedTo?: SystemId[], note?: string) => {
      const r = await post<PublishResult>('/api/appearance/design', { config, appliedTo, note });
      await reload();
      return r;
    },
    [reload],
  );
  const applyPatch = useCallback(
    async (patch: DesignPatch, systems: SystemId[], note?: string) => {
      const r = await post<PublishResult>('/api/appearance/design/apply', { patch, systems, note });
      await reload();
      return r;
    },
    [reload],
  );
  const perms = useMemo(
    () => ({
      edit: can('appearance.edit'),
      apply: can('configuration.apply', 'configuration.apply_all'),
      applyAll: can('configuration.apply_all'),
      rollback: can('configuration.rollback'),
      upload: can('font.upload'),
      google: can('font.google.manage'),
    }),
    [can],
  );
  if (!data) return <>{fallback({ loading, error })}</>;
  return <AppearanceCtx.Provider value={{ data, reload, publish, applyPatch, perms }}>{children}</AppearanceCtx.Provider>;
}

export const ALL_SYSTEM_IDS = SYSTEMS.map((s) => s.id) as SystemId[];
export const systemName = (id: string) => SYSTEMS.find((s) => s.id === id)?.name ?? id;

export function isEqual(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}
