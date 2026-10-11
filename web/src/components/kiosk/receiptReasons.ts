/** Display text for receipt verification codes (server: services/validation.ts). */
export const RECEIPT_REASON: Record<string, { en: string; th: string }> = {
  VERIFIED: { en: 'VERIFIED RECEIPT', th: 'ใบเสร็จถูกต้อง' },
  RECEIPT_NOT_FOUND: { en: 'RECEIPT NOT FOUND', th: 'ไม่พบใบเสร็จในระบบ' },
  INVALID_TOKEN: { en: 'INVALID RECEIPT CODE', th: 'รหัสตรวจสอบใบเสร็จไม่ถูกต้อง' },
  MERCHANT_NOT_ELIGIBLE: { en: 'MERCHANT NOT ELIGIBLE', th: 'ร้านค้าไม่ได้ร่วมรายการ' },
  RECEIPT_NOT_PAID: { en: 'RECEIPT NOT PAID', th: 'ใบเสร็จยังไม่ได้ชำระเงิน' },
  RECEIPT_VOIDED: { en: 'RECEIPT VOIDED', th: 'ใบเสร็จถูกยกเลิก' },
  RECEIPT_REFUNDED: { en: 'RECEIPT REFUNDED', th: 'ใบเสร็จถูกคืนเงิน' },
  RECEIPT_ALREADY_USED: { en: 'RECEIPT ALREADY USED', th: 'ใบเสร็จนี้ถูกใช้รับสิทธิ์แล้ว' },
  RECEIPT_EXPIRED: { en: 'RECEIPT EXPIRED', th: 'ใบเสร็จหมดอายุการใช้สิทธิ์' },
  SITE_NOT_ALLOWED: { en: 'SITE NOT ALLOWED', th: 'ใบเสร็จไม่ใช่ของสาขานี้' },
  BELOW_MIN_SPEND: { en: 'BELOW MINIMUM SPEND', th: 'ยอดซื้อไม่ถึงขั้นต่ำ' },
};

/** Preview/apply blocking codes. */
export const BLOCKING_TEXT: Record<string, string> = {
  SESSION_NOT_ACTIVE: 'รายการจอดนี้ปิดแล้ว',
  SELF_SERVICE_DISABLED: 'ไม่เปิดให้รับสิทธิ์ด้วยตนเองที่ตู้',
  MULTIPLE_RECEIPTS_NOT_ALLOWED: 'ใช้ได้ 1 ใบเสร็จต่อการจอด 1 ครั้ง',
  DAILY_LIMIT_REACHED: 'ทะเบียนนี้ใช้สิทธิ์ครบจำนวนต่อวันแล้ว',
  EXTERNAL_RECEIPT_ALREADY_USED: 'ใบเสร็จภายนอกนี้ถูกใช้แล้ว',
};

export function reasonText(code: string) {
  const r = RECEIPT_REASON[code];
  return r ? `${r.en} — ${r.th}` : code;
}

export function blockingText(code: string) {
  const [k, ref] = code.split(':');
  return (BLOCKING_TEXT[k] ?? k) + (ref ? ` (${ref})` : '');
}

type RewardLike = { type: 'AMOUNT' | 'MINUTES'; value: number } | { type: 'FULL' };
export function rewardText(r: RewardLike) {
  if (r.type === 'FULL') return 'จอดฟรีทั้งหมด';
  if (r.type === 'AMOUNT') return `ลด ${r.value.toLocaleString('th-TH')} บาท`;
  const h = Math.floor(r.value / 60);
  const m = r.value % 60;
  return `จอดฟรีเพิ่ม ${h ? `${h} ชม.` : ''}${h && m ? ' ' : ''}${m ? `${m} นาที` : ''}`;
}

export const METHOD_TEXT: Record<string, string> = { PROMPTPAY: 'PromptPay', CARD: 'บัตรเครดิต/เดบิต', CASH: 'เงินสด', EWALLET: 'e-Wallet' };
