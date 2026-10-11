/**
 * Typed settings modules with defaults + versioned history (config_versions).
 */
import { DEFAULT_LPR_POLICY, DEFAULT_VALIDATION_SETTINGS, normalizeDesign, type LprPolicy, type ValidationSettings, type DesignConfig } from '@pp/shared';
import { q, json, tx, nowIso } from '../db/index.ts';

export interface BrandingSettings {
  siteName: string;
  logoUrl: string;
  kioskBackgroundUrl: string;
  customerBackgroundUrl: string;
  languages: Array<'th' | 'en' | 'zh'>;
  defaultLanguage: 'th' | 'en' | 'zh';
  supportPhone: string;
  messages: { entryWelcome: string; exitThanks: string; lotFull: string; callStaff: string };
  sounds: { enabled: boolean; entry: string; exit: string; error: string };
}

export interface TicketTemplate {
  paperWidth: '58' | '80';
  title: string;
  subtitle: string;
  logoUrl: string;
  showProvince: boolean;
  showFreeTime: boolean;
  showRate: boolean;
  footerText: string;
  qrCount: number;   // how many QR codes to print
  qrSize: number;    // px at 203dpi
  fontScale: number;
  extraLines: string[];
}

export interface ReceiptTemplate {
  paperWidth: '58' | '80';
  header: string;
  footer: string;
  showVat: boolean;
  companyName: string;
  companyTaxId: string;
  companyAddress: string;
  companyBranch: string;
  vatRate: number;
  promoText: string;
}

export interface OperationSettings {
  autoIssueTicket: boolean;
  allowTicketWithoutPlate: boolean;    // issue ticket when plate unreadable
  duplicateEntryPolicy: 'FLAG' | 'CLOSE_PREVIOUS' | 'DENY';
  longStayHours: number;
  pendingPaymentExpiryMinutes: number;
  exitRequireProvinceMatch: boolean;
  offlineExitPolicy: 'DENY' | 'ALLOW_PAID_CACHE' | 'ALLOW_ALL';
  vehicleTypes: Array<{ code: string; name: string }>;
  memberBenefitsEnabled: boolean;
}

export interface PdpaSettings {
  imageRetentionDays: number;
  plateRetentionDays: number;  // anonymise plates on closed sessions after N days
  auditRetentionDays: number;
  maskPlatesForRoles: string[];
  privacyNotice: string;
}

export interface PaymentSettings {
  methods: { promptpay: boolean; card: boolean; cash: boolean; ewallet: boolean };
  graceMinutes: number;             // default; rate config may override
  vatRate: number;                  // parking fee VAT (included)
  issueTaxInvoice: boolean;
}

export interface Modules {
  branding: BrandingSettings;
  ticket: TicketTemplate;
  receipt: ReceiptTemplate;
  operation: OperationSettings;
  lpr: LprPolicy;
  validation: ValidationSettings;
  pdpa: PdpaSettings;
  payment: PaymentSettings;
  design: DesignConfig;
}

export const DEFAULTS: Modules = {
  branding: {
    siteName: 'SMART PARKING',
    logoUrl: '',
    kioskBackgroundUrl: '',
    customerBackgroundUrl: '',
    languages: ['th', 'en', 'zh'],
    defaultLanguage: 'th',
    supportPhone: '02-000-0000',
    messages: {
      entryWelcome: 'ยินดีต้อนรับ',
      exitThanks: 'ขอบคุณที่ใช้บริการ',
      lotFull: 'ขออภัย ลานจอดเต็ม',
      callStaff: 'กรุณาติดต่อเจ้าหน้าที่',
    },
    sounds: { enabled: true, entry: '', exit: '', error: '' },
  },
  ticket: {
    paperWidth: '80',
    title: 'SMART PARKING',
    subtitle: 'PARKING ENTRY TICKET',
    logoUrl: '',
    showProvince: true,
    showFreeTime: true,
    showRate: true,
    footerText: 'สแกนเพื่อดูเวลาจอดและชำระเงิน',
    qrCount: 1,
    qrSize: 240,
    fontScale: 1,
    extraLines: [],
  },
  receipt: {
    paperWidth: '80',
    header: 'ใบเสร็จรับเงินค่าจอดรถ',
    footer: 'ขอบคุณที่ใช้บริการ',
    showVat: true,
    companyName: 'PP Group Co., Ltd.',
    companyTaxId: '0000000000000',
    companyAddress: '',
    companyBranch: 'สำนักงานใหญ่',
    vatRate: 7,
    promoText: '',
  },
  operation: {
    autoIssueTicket: false,
    allowTicketWithoutPlate: true,
    duplicateEntryPolicy: 'FLAG',
    longStayHours: 24,
    pendingPaymentExpiryMinutes: 10,
    exitRequireProvinceMatch: false,
    offlineExitPolicy: 'ALLOW_PAID_CACHE',
    vehicleTypes: [
      { code: 'CAR', name: 'รถยนต์' },
      { code: 'MOTORCYCLE', name: 'รถจักรยานยนต์' },
      { code: 'VAN', name: 'รถตู้' },
      { code: 'TRUCK', name: 'รถบรรทุก' },
      { code: 'VIP', name: 'VIP' },
    ],
    memberBenefitsEnabled: true,
  },
  lpr: DEFAULT_LPR_POLICY,
  validation: DEFAULT_VALIDATION_SETTINGS,
  pdpa: {
    imageRetentionDays: 90,
    plateRetentionDays: 365,
    auditRetentionDays: 1825,
    maskPlatesForRoles: [],
    privacyNotice: 'ระบบมีการบันทึกภาพรถและป้ายทะเบียนเพื่อการให้บริการลานจอดรถและความปลอดภัย ตาม พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562',
  },
  payment: {
    methods: { promptpay: true, card: true, cash: true, ewallet: false },
    graceMinutes: 15,
    vatRate: 7,
    issueTaxInvoice: true,
  },
  design: normalizeDesign(null),
};

export type ModuleName = keyof Modules;
export const MODULE_NAMES = Object.keys(DEFAULTS) as ModuleName[];

const cache = new Map<string, unknown>();

export function getSetting<K extends ModuleName>(name: K): Modules[K] {
  if (cache.has(name)) return cache.get(name) as Modules[K];
  const row = q.get<{ value_json: string }>('SELECT value_json FROM settings WHERE key=?', name);
  const stored = json<Partial<Modules[K]>>(row?.value_json, {} as Partial<Modules[K]>);
  const value = name === 'design' ? (normalizeDesign(stored as Partial<DesignConfig>) as Modules[K]) : ({ ...(DEFAULTS[name] as object), ...(stored as object) } as Modules[K]);
  cache.set(name, value);
  return value;
}

export function clearSettingsCache() {
  cache.clear();
}

/** Save a module and create a version entry. Returns the version row. */
export function saveSetting<K extends ModuleName>(
  name: K,
  value: Modules[K],
  meta: { userId?: number | null; appliedTo?: unknown; note?: string; rolledBackFrom?: number } = {},
) {
  return tx(() => {
    const prev = getSetting(name);
    q.run(
      'INSERT INTO settings (key, value_json, updated_by, updated_at) VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_by=excluded.updated_by, updated_at=excluded.updated_at',
      name,
      JSON.stringify(value),
      meta.userId ?? null,
      nowIso(),
    );
    cache.delete(name);
    const last = q.get<{ v: number }>('SELECT COALESCE(MAX(version_no),0) v FROM config_versions WHERE module=?', name)!.v;
    const id = q.insert('config_versions', {
      module: name,
      version_no: last + 1,
      data_json: JSON.stringify(value),
      prev_json: JSON.stringify(prev),
      applied_to: meta.appliedTo === undefined ? null : JSON.stringify(meta.appliedTo),
      note: meta.note ?? null,
      rolled_back_from: meta.rolledBackFrom ?? null,
      created_by: meta.userId ?? null,
    });
    return q.get('SELECT id, module, version_no, applied_to, note, created_at FROM config_versions WHERE id=?', id)!;
  });
}
