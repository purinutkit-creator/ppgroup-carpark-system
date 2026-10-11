/**
 * Customer-facing translations (Thai / English / Chinese). Staff back-office
 * screens are Thai-first. Add keys here; missing keys fall back to Thai.
 */
import { createContext, useContext, useState, type ReactNode } from 'react';
import { storage } from './api';

export type Lang = 'th' | 'en' | 'zh';

const dict = {
  parking: { th: 'กำลังจอดรถ', en: 'Currently parked', zh: '停车中' },
  exited: { th: 'ออกจากลานจอดแล้ว', en: 'Exited', zh: '已离场' },
  plate: { th: 'หมายเลขทะเบียน', en: 'License plate', zh: '车牌号码' },
  province: { th: 'จังหวัด', en: 'Province', zh: '省份' },
  duration: { th: 'ระยะเวลาจอด', en: 'Parking duration', zh: '停车时长' },
  hms: { th: 'ชั่วโมง : นาที : วินาที', en: 'hours : minutes : seconds', zh: '时 : 分 : 秒' },
  currentFee: { th: 'ค่าจอดปัจจุบัน', en: 'Current fee', zh: '当前费用' },
  entryTime: { th: 'เวลาเข้า', en: 'Entry time', zh: '入场时间' },
  freeTime: { th: 'เวลาจอดฟรี', en: 'Free parking', zh: '免费时长' },
  stampDiscount: { th: 'ส่วนลดจากแสตมป์', en: 'Validation discount', zh: '盖章折扣' },
  promotion: { th: 'โปรโมชั่น', en: 'Promotion', zh: '促销' },
  amountDue: { th: 'ยอดชำระ ณ ขณะนี้', en: 'Amount due now', zh: '当前应付' },
  pay: { th: 'ชำระค่าจอดรถ', en: 'Pay parking fee', zh: '支付停车费' },
  paid: { th: 'ชำระแล้ว', en: 'Paid', zh: '已支付' },
  unpaid: { th: 'ยังไม่ชำระ', en: 'Unpaid', zh: '未支付' },
  exitBefore: { th: 'กรุณานำรถออกภายใน', en: 'Please exit before', zh: '请在此时间前离场' },
  graceExpired: { th: 'เกินเวลาออกหลังชำระ มีค่าจอดเพิ่มเติม', en: 'Exit time exceeded — additional fee applies', zh: '超出离场时间，需补缴费用' },
  scanToPay: { th: 'สแกน QR เพื่อชำระเงิน', en: 'Scan QR to pay', zh: '扫码支付' },
  waitingPayment: { th: 'รอการชำระเงิน…', en: 'Waiting for payment…', zh: '等待付款…' },
  paymentSuccess: { th: 'ชำระเงินสำเร็จ', en: 'Payment successful', zh: '支付成功' },
  history: { th: 'ประวัติส่วนลดและการชำระ', en: 'Discounts & payments', zh: '折扣与付款记录' },
  ticketInvalid: { th: 'ไม่พบบัตรจอดรถ หรือบัตรถูกใช้งานแล้ว', en: 'Ticket not found or already used', zh: '未找到停车票或已使用' },
  welcome: { th: 'ยินดีต้อนรับ', en: 'Welcome', zh: '欢迎' },
  start: { th: 'เริ่มต้น', en: 'Start', zh: '开始' },
  payParking: { th: 'ชำระค่าจอดรถ', en: 'Pay for parking', zh: '支付停车费' },
  scanTicket: { th: 'สแกน QR บัตรจอดรถ', en: 'Scan parking ticket QR', zh: '扫描停车票二维码' },
  enterPlate: { th: 'กรอกทะเบียนรถ', en: 'Enter license plate', zh: '输入车牌' },
  selectProvince: { th: 'เลือกจังหวัด', en: 'Select province', zh: '选择省份' },
  search: { th: 'ค้นหา', en: 'Search', zh: '搜索' },
  notFound: { th: 'ไม่พบรายการจอด', en: 'No parking record found', zh: '未找到停车记录' },
  currentTime: { th: 'เวลาปัจจุบัน', en: 'Current time', zh: '当前时间' },
  normalFee: { th: 'ค่าจอดปกติ', en: 'Parking fee', zh: '停车费' },
  receiptDiscount: { th: 'ส่วนลดจากใบเสร็จ', en: 'Receipt discount', zh: '小票折扣' },
  total: { th: 'ยอดชำระ', en: 'Total', zh: '应付金额' },
  scanReceipt: { th: 'สแกนใบเสร็จร้านค้า', en: 'Scan shop receipt', zh: '扫描商店小票' },
  validationSuccess: { th: 'รับสิทธิ์สำเร็จ ✓', en: 'Validation applied ✓', zh: '优惠已应用 ✓' },
  cash: { th: 'เงินสด', en: 'Cash', zh: '现金' },
  promptpay: { th: 'QR PromptPay', en: 'PromptPay QR', zh: 'PromptPay 二维码' },
  card: { th: 'บัตรเครดิต/เดบิต', en: 'Credit/Debit card', zh: '信用卡/借记卡' },
  back: { th: 'ย้อนกลับ', en: 'Back', zh: '返回' },
  cancel: { th: 'ยกเลิก', en: 'Cancel', zh: '取消' },
  done: { th: 'เสร็จสิ้น', en: 'Done', zh: '完成' },
  takeTicket: { th: 'กดรับบัตร', en: 'Press for ticket', zh: '按键取票' },
  pleaseTakeTicket: { th: 'กรุณารับบัตรจอดรถ', en: 'Please take your ticket', zh: '请取停车票' },
  barrierOpen: { th: 'เชิญผ่านได้', en: 'Please proceed', zh: '请通行' },
  callStaff: { th: 'เรียกเจ้าหน้าที่', en: 'Call staff', zh: '呼叫工作人员' },
  vehicleType: { th: 'ประเภทรถ', en: 'Vehicle type', zh: '车辆类型' },
  rate: { th: 'อัตราค่าจอด', en: 'Rate', zh: '收费标准' },
  ticketNo: { th: 'หมายเลขบัตร', en: 'Ticket no.', zh: '票号' },
  hours: { th: 'ชั่วโมง', en: 'hours', zh: '小时' },
  thankYou: { th: 'ขอบคุณที่ใช้บริการ', en: 'Thank you', zh: '谢谢光临' },
  outOfService: { th: 'งดให้บริการชั่วคราว', en: 'Temporarily out of service', zh: '暂停服务' },
  inService: { th: 'พร้อมให้บริการ', en: 'In service', zh: '服务中' },
  receiptPrinted: { th: 'กำลังพิมพ์ใบเสร็จ', en: 'Printing receipt', zh: '正在打印收据' },
} as const;

export type I18nKey = keyof typeof dict;

const LangCtx = createContext<{ lang: Lang; setLang: (l: Lang) => void; t: (k: I18nKey) => string }>({
  lang: 'th',
  setLang: () => {},
  t: (k) => dict[k]?.th ?? k,
});

export function I18nProvider({ children, initial }: { children: ReactNode; initial?: Lang }) {
  const [lang, setLangState] = useState<Lang>((storage.get('pp.lang') as Lang) || initial || 'th');
  const setLang = (l: Lang) => {
    storage.set('pp.lang', l);
    setLangState(l);
  };
  const t = (k: I18nKey) => (dict[k] as Record<Lang, string> | undefined)?.[lang] ?? dict[k]?.th ?? k;
  return <LangCtx.Provider value={{ lang, setLang, t }}>{children}</LangCtx.Provider>;
}

export const useI18n = () => useContext(LangCtx);

export function LangSwitch({ langs = ['th', 'en', 'zh'] }: { langs?: Lang[] }) {
  const { lang, setLang } = useI18n();
  const label: Record<Lang, string> = { th: 'ไทย', en: 'EN', zh: '中文' };
  return (
    <div className="lang-switch">
      {langs.map((l) => (
        <button key={l} className={l === lang ? 'active' : ''} onClick={() => setLang(l)} type="button">
          {label[l]}
        </button>
      ))}
    </div>
  );
}
