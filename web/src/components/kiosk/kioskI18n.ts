/**
 * Extra customer-facing strings for kiosks / customer web that are not in the
 * base dictionary (lib/i18n.tsx). `useKT()` resolves these first, then falls
 * back to the base `t()`, so screens can use one translator.
 */
import { useI18n, type I18nKey, type Lang } from '../../lib/i18n';

const extra = {
  driveForward: { th: 'กรุณาขับรถเข้ามาที่จุดหยุดรถ', en: 'Please drive forward to the stop line', zh: '请将车辆驶至停车线' },
  checkPlate: { th: 'กรุณาตรวจสอบทะเบียนรถก่อนกดรับบัตร', en: 'Please check your plate before taking a ticket', zh: '取票前请核对车牌' },
  unplatedTicket: { th: 'กดรับบัตร (ไม่ระบุทะเบียน)', en: 'Take ticket (no plate)', zh: '取票（无车牌）' },
  plateUnread: { th: 'ไม่สามารถอ่านป้ายทะเบียนได้', en: 'Plate could not be read', zh: '无法识别车牌' },
  waitStaff: { th: 'กรุณารอเจ้าหน้าที่', en: 'Please wait for staff', zh: '请等待工作人员' },
  ticketTakenBtn: { th: 'รับบัตรแล้ว', en: 'Ticket taken', zh: '已取票' },
  printing: { th: 'กำลังพิมพ์บัตร…', en: 'Printing ticket…', zh: '正在打印…' },
  printFailed: { th: 'พิมพ์บัตรไม่สำเร็จ กรุณาติดต่อเจ้าหน้าที่', en: 'Printing failed — please contact staff', zh: '打印失败，请联系工作人员' },
  ticketless: { th: 'รถสมาชิก ไม่ต้องรับบัตร', en: 'Registered vehicle — no ticket needed', zh: '会员车辆，无需取票' },
  entryDenied: { th: 'ไม่สามารถเข้าลานจอดได้', en: 'Entry not permitted', zh: '禁止入场' },
  lotFull: { th: 'ลานจอดเต็ม', en: 'Car park full', zh: '车位已满' },
  online: { th: 'ออนไลน์', en: 'Online', zh: '在线' },
  offline: { th: 'ออฟไลน์', en: 'Offline', zh: '离线' },
  freeHours: { th: 'จอดฟรี', en: 'Free parking', zh: '免费停车' },
  noDevice: { th: 'เครื่องนี้ยังไม่ได้ลงทะเบียนอุปกรณ์', en: 'This device is not registered', zh: '此设备尚未注册' },
  setupDevice: { th: 'ตั้งค่าอุปกรณ์', en: 'Set up device', zh: '设置设备' },
  scanTicketHint: { th: 'กรุณาสแกน QR บนบัตรจอดรถที่เครื่องสแกน', en: 'Please scan the QR code on your ticket', zh: '请扫描停车票上的二维码' },
  useCamera: { th: 'สแกนด้วยกล้อง', en: 'Scan with camera', zh: '使用摄像头扫描' },
  stopCamera: { th: 'ปิดกล้อง', en: 'Close camera', zh: '关闭摄像头' },
  cameraUnsupported: { th: 'อุปกรณ์นี้ไม่รองรับการสแกนด้วยกล้อง', en: 'Camera scanning is not supported on this device', zh: '此设备不支持摄像头扫描' },
  mismatch: { th: 'ทะเบียนไม่ตรงกับบัตร', en: 'Plate does not match the ticket', zh: '车牌与停车票不符' },
  supportPhone: { th: 'โทรติดต่อเจ้าหน้าที่', en: 'Call staff', zh: '联系工作人员' },
  staffComing: { th: 'กรุณารอสักครู่ หรือโทรติดต่อหมายเลขด้านล่าง', en: 'Please wait, or call the number below', zh: '请稍候，或拨打以下电话' },
  close: { th: 'ปิด', en: 'Close', zh: '关闭' },
  overstay: { th: 'เกินเวลาออกหลังชำระเงิน กรุณาชำระค่าจอดเพิ่มเติม', en: 'Exit time exceeded — please pay the additional fee', zh: '已超出离场时间，请补缴停车费' },
  feeDetail: { th: 'รายละเอียดค่าจอด', en: 'Fee details', zh: '费用明细' },
  discount: { th: 'ส่วนลด', en: 'Discount', zh: '折扣' },
  paidAlready: { th: 'ชำระแล้ว', en: 'Already paid', zh: '已付' },
  payCard: { th: 'แตะ/เสียบบัตรที่เครื่อง EDC', en: 'Tap or insert your card at the EDC terminal', zh: '请在刷卡机上感应或插入银行卡' },
  insertCash: { th: 'กรุณาใส่ธนบัตร/เหรียญ', en: 'Please insert cash', zh: '请投入现金' },
  cashInserted: { th: 'ใส่เงินแล้ว', en: 'Inserted', zh: '已投入' },
  change: { th: 'เงินทอน', en: 'Change', zh: '找零' },
  qrExpiresIn: { th: 'QR หมดอายุใน', en: 'QR expires in', zh: '二维码有效期' },
  qrExpired: { th: 'QR หมดอายุแล้ว', en: 'QR expired', zh: '二维码已过期' },
  newQr: { th: 'สร้าง QR ใหม่', en: 'New QR', zh: '重新生成' },
  mockPay: { th: 'จำลองการชำระเงิน (ทดสอบ)', en: 'Simulate payment (test)', zh: '模拟支付（测试）' },
  choosePayment: { th: 'เลือกวิธีชำระเงิน', en: 'Choose payment method', zh: '选择支付方式' },
  selectVehicle: { th: 'เลือกรถของท่าน', en: 'Select your vehicle', zh: '选择您的车辆' },
  noProvince: { th: 'ไม่ระบุจังหวัด', en: 'Skip province', zh: '跳过省份' },
  commonProvinces: { th: 'จังหวัดที่ใช้บ่อย', en: 'Common provinces', zh: '常用省份' },
  allProvinces: { th: 'จังหวัดทั้งหมด', en: 'All provinces', zh: '所有省份' },
  next: { th: 'ถัดไป', en: 'Next', zh: '下一步' },
  clear: { th: 'ล้าง', en: 'Clear', zh: '清除' },
  nothingDue: { th: 'ไม่มียอดค้างชำระ', en: 'Nothing to pay', zh: '无需付款' },
  exitNow: { th: 'สามารถนำรถออกได้', en: 'You may exit now', zh: '您现在可以离场' },
  purchase: { th: 'ยอดซื้อ', en: 'Purchase', zh: '消费金额' },
  parkingDiscount: { th: 'ส่วนลดค่าจอด', en: 'Parking discount', zh: '停车折扣' },
  oldFee: { th: 'ค่าจอดเดิม', en: 'Previous fee', zh: '原停车费' },
  newFee: { th: 'ยอดใหม่', en: 'New amount', zh: '新金额' },
  scanMore: { th: 'สแกนใบเสร็จเพิ่ม', en: 'Scan another receipt', zh: '继续扫描小票' },
  scanReceiptHint: { th: 'สแกน QR / บาร์โค้ดบนใบเสร็จร้านค้า', en: 'Scan the QR / barcode on the shop receipt', zh: '扫描小票上的二维码/条码' },
  receiptRejected: { th: 'ไม่สามารถใช้ใบเสร็จนี้ได้', en: 'This receipt cannot be used', zh: '此小票无法使用' },
  checking: { th: 'กำลังตรวจสอบ…', en: 'Checking…', zh: '正在验证…' },
  plateHint: { th: 'กรอกหมวดอักษรและตัวเลขทะเบียน', en: 'Enter plate letters and number', zh: '输入车牌字母和数字' },
  payments: { th: 'การชำระเงิน', en: 'Payments', zh: '付款' },
  stamps: { th: 'ประวัติแสตมป์ / ใบเสร็จ', en: 'Validation history', zh: '盖章/小票记录' },
  discounts: { th: 'ส่วนลด', en: 'Discounts', zh: '折扣' },
  paymentStatus: { th: 'สถานะการชำระ', en: 'Payment status', zh: '付款状态' },
  amount: { th: 'จำนวนเงิน', en: 'Amount', zh: '金额' },
  merchant: { th: 'ร้านค้า', en: 'Merchant', zh: '商户' },
  receiptNo: { th: 'ใบเสร็จ', en: 'Receipt', zh: '小票' },
  goToCard: { th: 'ไปหน้าชำระด้วยบัตร', en: 'Continue to card payment', zh: '前往银行卡支付' },
  sessionClosed: { th: 'รถของท่านออกจากลานจอดแล้ว ขอบคุณที่ใช้บริการ', en: 'Your vehicle has exited. Thank you!', zh: '您的车辆已离场，谢谢光临！' },
  minutes: { th: 'นาที', en: 'min', zh: '分钟' },
  pressToStart: { th: 'แตะหน้าจอเพื่อเริ่มต้น', en: 'Touch the screen to start', zh: '触摸屏幕开始' },
  paymentFailed: { th: 'การชำระเงินไม่สำเร็จ', en: 'Payment failed', zh: '支付失败' },
  tryAgain: { th: 'ลองอีกครั้ง', en: 'Try again', zh: '重试' },
  ticketNotFound: { th: 'ไม่พบบัตรจอดรถ', en: 'Ticket not found', zh: '未找到停车票' },
  welcomeEntry: { th: 'ยินดีต้อนรับ', en: 'Welcome', zh: '欢迎光临' },
  rateFrom: { th: 'อัตราค่าจอด', en: 'Parking rate', zh: '收费标准' },
  saveQrHint: { th: 'บันทึก/แคปหน้าจอ QR แล้วเปิดในแอปธนาคารได้', en: 'You can save a screenshot of the QR and open it in your banking app', zh: '可截图保存二维码并在银行App中打开' },
  perHour: { th: 'บาท/ชั่วโมง', en: 'THB/hour', zh: '泰铢/小时' },
} as const satisfies Record<string, Record<Lang, string>>;

export type KioskKey = keyof typeof extra;

export function useKT() {
  const { t, lang, setLang } = useI18n();
  const kt = (k: KioskKey | I18nKey): string => (k in extra ? extra[k as KioskKey][lang] : t(k as I18nKey));
  return { t: kt, lang, setLang };
}

const VEHICLE: Record<string, Record<Lang, string>> = {
  CAR: { th: 'รถยนต์', en: 'Car', zh: '汽车' },
  MOTORCYCLE: { th: 'รถจักรยานยนต์', en: 'Motorcycle', zh: '摩托车' },
  VAN: { th: 'รถตู้', en: 'Van', zh: '面包车' },
  TRUCK: { th: 'รถบรรทุก', en: 'Truck', zh: '卡车' },
  VIP: { th: 'VIP', en: 'VIP', zh: 'VIP' },
};
export const vehicleName = (code: string | null | undefined, lang: Lang) => (code ? (VEHICLE[code]?.[lang] ?? code) : '-');

/** Free time "2 ชม. 30 นาที" in the current language. */
export function freeTimeText(minutes: number, lang: Lang) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const u = { th: ['ชม.', 'นาที'], en: ['h', 'min'], zh: ['小时', '分钟'] }[lang];
  return [h ? `${h} ${u[0]}` : '', m || !h ? `${m} ${u[1]}` : ''].filter(Boolean).join(' ');
}
