/** Shapes returned by /api/pos and /api/merchants (server is the source of truth). */
import { api, getDeviceKey, type RequestOptions } from '../../lib/api';

export interface ReceiptInfo {
  header?: string;
  footer?: string;
  vatRegistered?: boolean;
  taxId?: string;
  branchName?: string;
  vatMode: 'INCLUDED' | 'EXCLUDED';
  vatRate: number;
  serviceChargePercent: number;
  promptPayId?: string;
}

export interface Variant {
  name: string;
  price: number;
}
export interface ModifierGroup {
  group: string;
  multi: boolean;
  options: Array<{ name: string; price: number }>;
}
export interface Product {
  id: number;
  category_id: number | null;
  name: string;
  sku: string | null;
  barcode: string | null;
  price: number;
  image_url: string | null;
  variants: Variant[];
  modifiers: ModifierGroup[];
  vat_applicable: boolean;
  track_stock: boolean;
  stock: number | null;
  active: boolean;
  sort: number;
}
export interface Category {
  id: number;
  name: string;
  sort: number;
  active: number;
}

export interface CartLine {
  key: string;
  productId: number;
  name: string;
  imageUrl?: string | null;
  variantName: string | null;
  modifiers: Array<{ group: string; name: string }>;
  unitPrice: number; // client preview only
  qty: number;
  discount: number | null;
}
export interface Cart {
  lines: CartLine[];
  billDiscount: number | null;
  billDiscountPercent: number | null;
  memberPhone: string;
}

export interface PricedCart {
  lines: Array<{ productId: number; name: string; variant: string | null; modifiers: Array<{ group: string; name: string; price: number }>; qty: number; unitPrice: number; gross: number; discount: number; net: number }>;
  subtotal: number;
  lineDiscount: number;
  billDiscount: number;
  discount: number;
  serviceChargePercent: number;
  serviceCharge: number;
  vatMode: 'INCLUDED' | 'EXCLUDED';
  vatRate: number;
  vat: number;
  total: number;
}

export interface Payment {
  method: 'CASH' | 'PROMPTPAY' | 'CARD' | 'TRANSFER' | 'EWALLET' | string;
  amount: number;
  ref?: string | null;
  change?: number;
}

export interface ReceiptData {
  store: { name: string; code: string; logoUrl: string | null; header: string; footer: string; taxId: string | null; vatRegistered: boolean; branchCode: string; branchName: string; unitNo: string | null };
  receiptNo: string;
  issuedAt: string;
  cashier: string | null;
  memberPhone: string | null;
  items: PricedCart['lines'];
  subtotal: number;
  discount: number;
  serviceCharge: number;
  vat: number;
  vatMode: 'INCLUDED' | 'EXCLUDED';
  vatRate: number;
  total: number;
  refundedAmount: number;
  payments: Payment[];
  change: number;
  status: string;
  reprintCount: number;
  parking: null | { payload: string; receiptNo: string; eligibleAmount: number; minSpend: number };
}

export interface Sale {
  id: number;
  receipt_no: string;
  status: string;
  total: number;
  subtotal: number;
  discount: number;
  vat: number;
  refunded_amount: number;
  parking_validation_status: string;
  issued_at: string;
  cashier_name?: string | null;
  branch_code?: string;
  member_phone?: string | null;
  items: PricedCart['lines'];
  payments: Payment[];
  barcode: string;
  external: boolean;
  plate_text?: string | null;
  parking_no?: string | null;
  usage_status?: string | null;
  validated_at?: string | null;
  reprint_count: number;
}

export interface PrinterConfig {
  id?: number;
  connection?: { mode?: 'lan' | 'edge' | 'bridge'; bridgeUrl?: string; paperWidth?: '58' | '80' };
}

export interface PosMe {
  merchant: { id: number; code: string; name: string; logo_url: string | null; status: string; pos_enabled: number; validation_enabled: number; receipt_info: ReceiptInfo };
  branch: { id: number; code: string; name: string };
  device: null | { id: number; name: string; printer: PrinterConfig | null; cashDrawer: boolean; displayEnabled: boolean };
  user: null | { id: number; displayName: string; role: string };
  shift: null | { id: number; opened_at: string; opening_cash: number };
  heldCount: number;
  tz: number;
}

export const PAYMENT_LABEL: Record<string, string> = {
  CASH: 'เงินสด',
  PROMPTPAY: 'PromptPay',
  CARD: 'บัตรเครดิต/เดบิต',
  TRANSFER: 'โอนเงิน',
  EWALLET: 'e-Wallet',
  EXTERNAL: 'POS ภายนอก',
};

export const SALE_STATUS_LABEL: Record<string, string> = {
  PAID: 'ชำระแล้ว',
  VOIDED: 'ยกเลิก (Void)',
  REFUNDED: 'คืนเงินแล้ว',
  PARTIALLY_REFUNDED: 'คืนเงินบางส่วน',
};

export const VALIDATION_STATUS_LABEL: Record<string, string> = {
  NOT_USED: 'ยังไม่ใช้สิทธิ์',
  USED: 'ใช้สิทธิ์จอดรถแล้ว',
  REFUNDED_AFTER_VALIDATION: 'คืนเงินหลังใช้สิทธิ์',
};

export const MERCHANT_STATUS_LABEL: Record<string, string> = {
  PENDING: 'รออนุมัติ',
  APPROVED: 'อนุมัติแล้ว',
  ACTIVE: 'ใช้งาน',
  SUSPENDED: 'ระงับ',
  CLOSED: 'ปิดร้าน',
  REJECTED: 'ปฏิเสธ',
};

export const MERCHANT_CATEGORIES: Array<{ value: string; label: string }> = [
  { value: 'CAFE', label: 'คาเฟ่ / เครื่องดื่ม' },
  { value: 'RESTAURANT', label: 'ร้านอาหาร' },
  { value: 'SUPERMARKET', label: 'ซูเปอร์มาร์เก็ต' },
  { value: 'CINEMA', label: 'โรงภาพยนตร์' },
  { value: 'FASHION', label: 'แฟชั่น' },
  { value: 'BEAUTY', label: 'ความงาม / สุขภาพ' },
  { value: 'ELECTRONICS', label: 'อิเล็กทรอนิกส์' },
  { value: 'SERVICE', label: 'บริการ' },
  { value: 'VIP_STORE', label: 'VIP Store' },
  { value: 'OTHER', label: 'อื่น ๆ' },
];

/** Staff token plus this terminal's POS device key (when the PC was set up as a POS). */
export function posApi<T = any>(path: string, opts: RequestOptions = {}) {
  const dk = getDeviceKey();
  return api<T>(path, { ...opts, headers: { ...(opts.headers ?? {}), ...(dk ? { 'X-Device-Key': dk } : {}) } });
}
export const posGet = <T = any>(p: string) => posApi<T>(p, { method: 'GET' });
export const posPost = <T = any>(p: string, body?: unknown) => posApi<T>(p, { method: 'POST', body: body ?? {} });

export const r2 = (n: number) => Math.round(n * 100) / 100;

/** Rough client preview of a line (the server recomputes everything at checkout). */
export function linePreview(p: Product, variantName: string | null, mods: Array<{ group: string; name: string }>) {
  let unit = p.price;
  const v = p.variants.find((x) => x.name === variantName) ?? (variantName === null ? p.variants[0] : undefined);
  if (v) unit += v.price;
  for (const m of mods) unit += p.modifiers.find((g) => g.group === m.group)?.options.find((o) => o.name === m.name)?.price ?? 0;
  return r2(unit);
}
