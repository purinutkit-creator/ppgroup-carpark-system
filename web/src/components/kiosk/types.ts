/**
 * Client-side shapes of the server responses used by the front-line apps
 * (mirrors server/src/services/{sessions,gates,payments,validation}.ts).
 */
import type { PrinterTarget } from '../../print/print';
import type { TicketData } from '../../print/templates';
import type { RewardResult } from '@pp/shared/validation';

export interface FeeLine {
  label: string;
  amount: number;
  detail?: string;
}

export interface QuoteDiscount {
  id: number;
  type: string;
  label: string;
  amount: number;
  freeMinutes: number;
  full: boolean;
  status: string;
  createdAt: string;
  totalSpend: number | null;
}

export interface Quote {
  sessionId: number;
  parkingNo: string;
  status: string;
  paymentStatus: string;
  plate: { prefix: string | null; number: string | null; text: string | null; provinceCode: string | null; province: string | null; source: string | null };
  vehicleType: string;
  entryAt: string;
  exitAt: string | null;
  now: string;
  chargedUntil: string;
  durationSeconds: number;
  rate: { planName: string; freeMinutes: number; hourlyRate: number; billingUnitMinutes: number; graceAfterPaymentMinutes: number };
  gross: number;
  feeLines: FeeLine[];
  extraFreeMinutes: number;
  discountFromFreeTime: number;
  discountAmount: number;
  memberDiscount: number;
  discountTotal: number;
  net: number;
  paid: number;
  due: number;
  exempt: boolean;
  fullWaiver: boolean;
  discounts: QuoteDiscount[];
  lastPaidAt: string | null;
  exitDeadlineAt: string | null;
  withinGrace: boolean;
  nextChangeAt: string | null;
  canExit: boolean;
}

export interface SessionSummary {
  id: number;
  parkingNo: string;
  siteId: number;
  plateText: string | null;
  province: string | null;
  provinceCode: string | null;
  vehicleType: string;
  entryAt: string;
  exitAt: string | null;
  status: string;
  paymentStatus: string;
  ticketless: boolean;
  unreadPlate: boolean;
  lostTicket: boolean;
  exempt: boolean;
  flags: string[];
  lastPaidAt: string | null;
  exitDeadlineAt: string | null;
}

export interface DetectionView {
  id: number;
  capturedAt: string;
  decision: string;
  vehicleType: string | null;
  plate: { prefix: string | null; number: string | null; provinceCode: string | null; province: string | null; text: string | null; sourceType: string | null };
}

export type TicketPayload = TicketData;

export type GateState =
  | { kind: 'IDLE'; at: string }
  | { kind: 'ENTRY_CONFIRM'; at: string; detection: DetectionView; decision: string; allowUnplated: boolean }
  | { kind: 'ENTRY_REVIEW'; at: string; detection: DetectionView | null; allowUnplated: boolean; message: string }
  | { kind: 'TICKET_ISSUED'; at: string; session: SessionSummary; ticket: TicketPayload | null; ticketless: boolean }
  | { kind: 'ENTRY_DENIED'; at: string; reason: string; message: string }
  | { kind: 'EXIT_OPEN'; at: string; session: SessionSummary; message: string }
  | { kind: 'EXIT_PAYMENT'; at: string; session: SessionSummary; quote: Quote; overstay: boolean }
  | { kind: 'EXIT_NOT_FOUND'; at: string; detection: DetectionView | null; message: string }
  | { kind: 'EXIT_MISMATCH'; at: string; session: SessionSummary; detection: DetectionView | null; message: string };

export interface Payment {
  id: number;
  amount: number;
  method: string;
  gateway: string;
  status: string;
  qrPayload: string | null;
  qrImageUrl: string | null;
  expiresAt: string | null;
  paidAt: string | null;
  createdAt: string;
  channel: string;
  cashReceived: number | null;
  changeGiven: number | null;
}

export interface Branding {
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

export interface PaymentMethods {
  promptpay: boolean;
  card: boolean;
  cash: boolean;
  ewallet: boolean;
}

export interface ReceiptTemplate {
  paperWidth: '58' | '80';
  header: string;
  footer: string;
  showVat: boolean;
  companyName: string;
  companyTaxId: string;
  companyAddress: string;
  vatRate: number;
}

export interface Bootstrap {
  device: { id: number; type: string; name: string; site_id: number | null; gate_id: number | null; settings: Record<string, any> } | null;
  gate: { id: number; name: string; direction: 'ENTRY' | 'EXIT'; site_id: number; zone_id: number | null } | null;
  site: { id: number; code: string; name: string } | null;
  printers: Array<PrinterTarget & { name: string }>;
  branding: Branding;
  ticket: Record<string, unknown>;
  receipt: ReceiptTemplate;
  operation: { autoIssueTicket: boolean; allowTicketWithoutPlate: boolean };
  validation: { selfServiceKiosk: boolean; allowMultipleReceipts: boolean };
  paymentMethods: PaymentMethods;
  /** Optional: initial rate of the gate (shown on the entry confirmation screen when provided). */
  rate?: { freeMinutes: number; hourlyRate: number } | null;
}

export interface PublicConfig {
  branding: Branding;
  paymentMethods: PaymentMethods;
  privacyNotice: string;
  provider: string;
}

export interface VerifiedReceipt {
  code: string;
  ok: boolean;
  reasons: string[];
  receipt: null | {
    saleId: number;
    receiptNo: string;
    merchantId: number;
    merchantCode: string;
    merchantName: string;
    branchCode: string;
    issuedAt: string;
    subtotal: number;
    discount: number;
    total: number;
    status: string;
    refundedAmount: number;
    validationStatus: string;
    usedBy?: { parkingNo: string; plateText: string | null; at: string } | null;
  };
}

export interface ExternalReceipt {
  ref: string;
  amount: number;
  merchantId?: number | null;
}

export interface ValidationPreview {
  session: Quote;
  receipts: VerifiedReceipt[];
  external: ExternalReceipt[];
  eligibleSpend: number;
  reward: RewardResult;
  after: { net: number; due: number; discount: number } | null;
  blocking: string[];
}

export interface KioskContentItem {
  id: number;
  title: string;
  kind: 'IMAGE' | 'VIDEO';
  category: string;
  url: string;
  layout: 'FULL' | 'SPLIT';
  durationSec: number;
}
