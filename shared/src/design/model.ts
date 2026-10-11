/**
 * Centralized Design Configuration.
 *
 * Hierarchy: Global → System → Page → Component → Element.
 * Element path = "<system>/<page>/<component>/<element>"; page key =
 * "<system>/<page>"; component key = "<system>/<page>/<component>".
 * Every level holds partial overrides; `resolveTypography` merges them and
 * reports which level each property came from ("Inherited from: Global").
 */

export const SYSTEMS = [
  { id: 'admin', name: 'Parking Admin' },
  { id: 'entry-kiosk', name: 'Entry Kiosk', group: 'kiosk' },
  { id: 'exit-kiosk', name: 'Exit Kiosk', group: 'kiosk' },
  { id: 'payment-kiosk', name: 'Payment Kiosk', group: 'kiosk' },
  { id: 'merchant-pos', name: 'Merchant POS', group: 'merchant' },
  { id: 'merchant-portal', name: 'Merchant Portal', group: 'merchant' },
  { id: 'info-counter', name: 'Information Counter' },
  { id: 'customer-web', name: 'Customer Parking Website', group: 'customer' },
  { id: 'customer-display', name: 'Customer Display', group: 'customer' },
  { id: 'dashboard', name: 'Dashboard' },
  { id: 'receipt', name: 'Receipt', group: 'print' },
  { id: 'parking-ticket', name: 'Parking Ticket', group: 'print' },
  { id: 'reports', name: 'Reports', group: 'print' },
  { id: 'print-templates', name: 'Print Templates', group: 'print' },
] as const;
export type SystemId = (typeof SYSTEMS)[number]['id'];

export const SYSTEM_GROUPS: Record<string, { label: string; systems: SystemId[] }> = {
  all: { label: 'Entire System', systems: SYSTEMS.map((s) => s.id) },
  kiosk: { label: 'All Kiosks', systems: ['entry-kiosk', 'exit-kiosk', 'payment-kiosk'] },
  merchant: { label: 'All Merchant POS', systems: ['merchant-pos', 'merchant-portal'] },
  customer: { label: 'Customer Screens', systems: ['customer-web', 'customer-display'] },
  print: { label: 'Print Templates', systems: ['receipt', 'parking-ticket', 'reports', 'print-templates'] },
};

export type FontRole = 'primary' | 'heading' | 'number' | 'button' | 'receipt' | 'kiosk' | 'plate';
export const FONT_ROLES: { id: FontRole; label: string }[] = [
  { id: 'primary', label: 'Primary Font' },
  { id: 'heading', label: 'Heading Font' },
  { id: 'number', label: 'Number Font' },
  { id: 'button', label: 'Button Font' },
  { id: 'receipt', label: 'Receipt Font' },
  { id: 'kiosk', label: 'Kiosk Font' },
  { id: 'plate', label: 'License Plate Font' },
];

export interface TypographyStyle {
  fontFamily: string;
  fontSize: number;     // px
  fontWeight: number;
  fontStyle: 'normal' | 'italic';
  lineHeight: number;   // unitless
  letterSpacing: number; // px
  textAlign: 'left' | 'center' | 'right' | 'justify' | 'inherit';
  textTransform: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  textDecoration: 'none' | 'underline' | 'line-through';
  color: string;        // '' = inherit
}
export type TypographyProp = keyof TypographyStyle;
export const TYPOGRAPHY_PROPS: TypographyProp[] = [
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'textAlign', 'textTransform', 'textDecoration', 'color',
];

export interface DesignTokens {
  theme: 'light' | 'dark';
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
  text: string;
  textMuted: string;
  buttonBg: string;
  buttonText: string;
  border: string;
  success: string;
  warning: string;
  danger: string;
  radius: number;       // px
  borderWidth: number;  // px
  shadow: 'none' | 'sm' | 'md' | 'lg';
  spacing: number;      // base spacing px
  iconStyle: 'outline' | 'filled';
  inputStyle: 'outline' | 'filled' | 'underline';
  modalStyle: 'center' | 'sheet';
  cardStyle: 'flat' | 'outlined' | 'elevated';
  backgroundImage: string; // media URL or ''
}

export interface LevelOverride {
  fonts?: Partial<Record<FontRole, string>>;
  tokens?: Partial<DesignTokens>;
  /** Applies to every text in this scope. */
  text?: Partial<TypographyStyle>;
}

export interface FontAsset {
  family: string;
  source: 'GOOGLE' | 'UPLOAD' | 'SYSTEM';
  weights: number[];
  files?: Array<{ weight: number; style: 'normal' | 'italic'; url: string; format: string }>;
}

export interface DesignConfig {
  global: {
    fonts: Record<FontRole, string>;
    languageFonts: { th: string; en: string; zh: string; enabled: boolean };
    fallback: string;
    tokens: DesignTokens;
    text?: Partial<TypographyStyle>;
  };
  systems: Partial<Record<SystemId, LevelOverride>>;
  pages: Record<string, LevelOverride>;
  components: Record<string, LevelOverride>;
  elements: Record<string, Partial<TypographyStyle>>;
  fonts: FontAsset[]; // fonts that must be loaded by clients
}

export const DEFAULT_TOKENS: DesignTokens = {
  theme: 'light',
  primary: '#1d4ed8',
  secondary: '#0f766e',
  accent: '#f59e0b',
  background: '#f4f6fb',
  surface: '#ffffff',
  text: '#0f172a',
  textMuted: '#64748b',
  buttonBg: '#1d4ed8',
  buttonText: '#ffffff',
  border: '#e2e8f0',
  success: '#16a34a',
  warning: '#d97706',
  danger: '#dc2626',
  radius: 10,
  borderWidth: 1,
  shadow: 'sm',
  spacing: 8,
  iconStyle: 'outline',
  inputStyle: 'outline',
  modalStyle: 'center',
  cardStyle: 'elevated',
  backgroundImage: '',
};

export const DARK_TOKENS: Partial<DesignTokens> = {
  theme: 'dark',
  background: '#0b1220',
  surface: '#111a2e',
  text: '#e2e8f0',
  textMuted: '#94a3b8',
  border: '#1e293b',
};

export const DEFAULT_DESIGN: DesignConfig = {
  global: {
    fonts: {
      primary: 'Sarabun',
      heading: 'Kanit',
      number: 'Prompt',
      button: 'Sarabun',
      receipt: 'Sarabun',
      kiosk: 'Kanit',
      plate: 'Sarabun',
    },
    languageFonts: { th: 'Sarabun', en: 'Inter', zh: 'Noto Sans SC', enabled: false },
    fallback: 'system-ui, -apple-system, "Segoe UI", Tahoma, sans-serif',
    tokens: DEFAULT_TOKENS,
  },
  systems: {},
  pages: {},
  components: {},
  elements: {},
  fonts: [
    { family: 'Sarabun', source: 'GOOGLE', weights: [400, 500, 600, 700] },
    { family: 'Kanit', source: 'GOOGLE', weights: [400, 500, 600, 700] },
    { family: 'Prompt', source: 'GOOGLE', weights: [400, 500, 600, 700] },
  ],
};

export const BASE_TYPOGRAPHY: TypographyStyle = {
  fontFamily: '',
  fontSize: 16,
  fontWeight: 400,
  fontStyle: 'normal',
  lineHeight: 1.5,
  letterSpacing: 0,
  textAlign: 'inherit',
  textTransform: 'none',
  textDecoration: 'none',
  color: '',
};
