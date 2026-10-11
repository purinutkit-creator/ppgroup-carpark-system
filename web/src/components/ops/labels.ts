/** Thai labels for operational codes shown on admin screens. */

export const SESSION_STATUS: Record<string, string> = { ACTIVE: 'จอดอยู่', EXITED: 'ออกแล้ว', CANCELLED: 'ยกเลิก' };
export const PAYMENT_STATUS: Record<string, string> = { UNPAID: 'ยังไม่ชำระ', PAID: 'ชำระแล้ว', WAIVED: 'ยกเว้น', FREE: 'ฟรี' };
export const PAYMENT_ROW_STATUS: Record<string, string> = {
  PENDING: 'รอชำระ', PAID: 'ชำระแล้ว', FAILED: 'ล้มเหลว', EXPIRED: 'หมดอายุ', CANCELLED: 'ยกเลิก', REFUNDED: 'คืนเงินแล้ว', PARTIALLY_REFUNDED: 'คืนเงินบางส่วน',
};
export const METHOD: Record<string, string> = { CASH: 'เงินสด', PROMPTPAY: 'PromptPay', CARD: 'บัตร', EWALLET: 'e-Wallet', WAIVER: 'ยกเว้น' };
export const CHANNEL: Record<string, string> = { WEB: 'เว็บลูกค้า', PAYMENT_KIOSK: 'Payment Kiosk', EXIT_KIOSK: 'Kiosk ทางออก', COUNTER: 'เคาน์เตอร์' };

export const SOURCE_TYPE: Record<string, string> = {
  REAL_PLATE: 'ป้ายทะเบียนจริง',
  TEMPORARY_PLATE: 'ป้ายแดง/ชั่วคราว',
  PAPER_SIGN: 'ป้ายกระดาษ',
  WINDSHIELD_TEXT: 'ข้อความกระจกหน้า',
  GENERAL_OCR: 'OCR ทั่วไป',
  MANUAL_ENTRY: 'เจ้าหน้าที่กรอก',
};

export const DECISION: Record<string, string> = {
  AUTO_CONFIRM: 'ยืนยันอัตโนมัติ', KIOSK_CONFIRM: 'ให้ลูกค้ายืนยัน', MANUAL_REVIEW: 'ต้องตรวจสอบ', NO_READ: 'อ่านไม่ได้',
};

export const REASON: Record<string, string> = {
  PROVINCE_UNREADABLE: 'อ่านจังหวัดไม่ได้',
  PROVINCE_CORRECTED: 'แก้ไขจังหวัดอัตโนมัติ',
  MULTIPLE_DIFFERENT_PLATES: 'พบหลายทะเบียนไม่ตรงกัน',
  LOW_PLATE_CONFIDENCE: 'ความมั่นใจทะเบียนต่ำ',
  LOW_PROVINCE_CONFIDENCE: 'ความมั่นใจจังหวัดต่ำ',
  NO_VALID_CANDIDATE: 'ไม่พบทะเบียนที่ถูกต้อง',
  NO_PLATE_PATTERN: 'ไม่ตรงรูปแบบทะเบียน',
};

export const REVIEW_STATUS: Record<string, string> = { NONE: '-', PENDING: 'รอตรวจสอบ', RESOLVED: 'แก้ไขแล้ว', DISMISSED: 'ปิดรายการ' };

export const ALERT_TYPE: Record<string, string> = {
  DEVICE_OFFLINE: 'อุปกรณ์ออฟไลน์',
  DEVICE_ONLINE: 'อุปกรณ์กลับมาออนไลน์',
  LONG_STAY: 'จอดนานผิดปกติ',
  BLACKLIST: 'รถในบัญชีดำ',
  PLATE_MISMATCH: 'ทะเบียนไม่ตรงตอนออก',
  LPR_REVIEW: 'ตรวจสอบป้ายทะเบียน',
  DUPLICATE_PAYMENT: 'ชำระเงินซ้ำ',
  LOT_FULL: 'ลานจอดเต็ม',
  RECEIPT_REFUND: 'คืนเงินใบเสร็จที่ใช้สิทธิ์แล้ว',
  MANUAL_BARRIER: 'เปิดไม้กั้นด้วยมือ',
  PAYMENT_FAILED: 'ชำระเงินล้มเหลว',
  EXIT_ASSIST: 'ขอความช่วยเหลือที่ทางออก',
  SYNC_CONFLICT: 'ข้อมูลออฟไลน์ขัดแย้ง',
};
export const SEVERITY: Record<string, string> = { CRITICAL: 'วิกฤต', WARNING: 'เตือน', INFO: 'ข้อมูล' };

export const DISCOUNT_TYPE: Record<string, string> = {
  RECEIPT_VALIDATION: 'ประทับตราใบเสร็จ',
  MANUAL_STAMP: 'แสตมป์ (กรอกยอด)',
  MANUAL_DISCOUNT: 'ส่วนลดโดยเจ้าหน้าที่',
  MEMBER: 'สิทธิ์สมาชิก',
  PROMOTION: 'โปรโมชั่น',
  WAIVER: 'ยกเว้นค่าจอด',
};

export const FLAG: Record<string, string> = {
  PLATE_MISMATCH: 'ทะเบียนไม่ตรง',
  MISMATCH_APPROVED: 'อนุมัติทะเบียนไม่ตรง',
  DUPLICATE_ENTRY: 'เข้าซ้ำ',
  AUTO_CLOSED_DUPLICATE: 'ปิดอัตโนมัติ (เข้าซ้ำ)',
  LONG_STAY: 'จอดนาน',
};

export const VEHICLE_TYPES = [
  { value: 'CAR', label: 'รถยนต์' },
  { value: 'MOTORCYCLE', label: 'รถจักรยานยนต์' },
  { value: 'VAN', label: 'รถตู้' },
  { value: 'TRUCK', label: 'รถบรรทุก' },
  { value: 'VIP', label: 'VIP' },
];

export const DEVICE_TYPE: Record<string, string> = {
  CAMERA: 'กล้อง', PRINTER: 'เครื่องพิมพ์', BARRIER: 'ไม้กั้น', ENTRY_KIOSK: 'Kiosk ทางเข้า', EXIT_KIOSK: 'Kiosk ทางออก',
  PAYMENT_KIOSK: 'Payment Kiosk', COUNTER: 'เคาน์เตอร์', EDGE: 'Edge', DISPLAY: 'จอแสดงผล', POS: 'POS',
};

export const GATE_STATE: Record<string, string> = {
  IDLE: 'ว่าง',
  ENTRY_CONFIRM: 'รอลูกค้ายืนยันทะเบียน',
  ENTRY_REVIEW: 'ต้องตรวจสอบ/ออกบัตรด้วยมือ',
  TICKET_ISSUED: 'ออกบัตรแล้ว รอรับบัตร',
  ENTRY_DENIED: 'ปฏิเสธการเข้า',
  EXIT_OPEN: 'เปิดไม้กั้นออก',
  EXIT_PAYMENT: 'รอชำระเงิน',
  EXIT_NOT_FOUND: 'ไม่พบรายการจอด',
  EXIT_MISMATCH: 'ทะเบียนไม่ตรง รออนุมัติ',
};

export const label = (map: Record<string, string>, code: string | null | undefined) => (code ? map[code] ?? code : '-');

export const pct = (n: number | null | undefined) => (n == null ? '-' : `${Math.round(Number(n))}%`);

export function confidenceTone(n: number | null | undefined): 'success' | 'warning' | 'danger' {
  const v = Number(n ?? 0);
  return v >= 90 ? 'success' : v >= 70 ? 'warning' : 'danger';
}

/** Where an alert's reference lives in the admin UI. */
export function alertLink(a: { refType: string | null; refId: string | null }) {
  if (a.refType === 'session' && a.refId) return `/admin/sessions/${a.refId}`;
  if (a.refType === 'detection') return '/admin/review';
  if (a.refType === 'gate') return '/admin/gates';
  if (a.refType === 'payment') return '/admin/payments';
  return null;
}
