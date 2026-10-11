/**
 * First-run seed. Creates an owner account and, unless SEED_DEMO=0, a demo
 * site with gates, devices, rate plans, validation rules, a demo merchant with
 * POS data and staff accounts for every role.
 */
import crypto from 'node:crypto';
import { DEFAULT_RATE, type RateConfig } from '@pp/shared';
import { db, q, tx } from './index.ts';
import { hashPassword, sha256, randomToken } from '../lib/crypto.ts';
import { config } from '../config.ts';

export const DEMO_DEVICE_KEYS: Record<string, string> = {
  'ENTRY-CAM': 'demo-entry-camera-key',
  'EXIT-CAM': 'demo-exit-camera-key',
  'ENTRY-KIOSK': 'demo-entry-kiosk-key',
  'EXIT-KIOSK': 'demo-exit-kiosk-key',
  'PAY-KIOSK': 'demo-payment-kiosk-key',
  COUNTER: 'demo-counter-key',
  EDGE: 'demo-edge-key',
  POS: 'demo-pos-key',
};

export function ensureSeed() {
  const has = q.get<{ n: number }>('SELECT COUNT(*) n FROM users')!.n;
  if (has) return;
  const demo = process.env.SEED_DEMO !== '0';
  tx(() => {
    seedBase();
    if (demo) seedDemo();
  });
  console.log(`Seeded database (${demo ? 'with demo data' : 'owner only'}).`);
}

function seedBase() {
  const pw = process.env.ADMIN_PASSWORD ?? (config.env === 'production' ? randomToken(9) : 'admin1234');
  q.insert('users', { username: 'owner', display_name: 'System Owner', password_hash: hashPassword(pw), pin_hash: hashPassword('1234'), role: 'OWNER' });
  if (!process.env.ADMIN_PASSWORD) console.log(`Owner account: owner / ${pw}  (set ADMIN_PASSWORD to choose; change it after first login)`);
  for (const [code, name, sort, benefits] of [
    ['REGULAR', 'Regular', 0, {}],
    ['SILVER', 'Silver', 1, { extraFreeMinutes: 30 }],
    ['GOLD', 'Gold', 2, { extraFreeMinutes: 60 }],
    ['PLATINUM', 'Platinum', 3, { extraFreeMinutes: 120, discountPercent: 10 }],
    ['VIP', 'VIP', 4, { extraFreeMinutes: 240, discountPercent: 50 }],
  ] as const) {
    q.insert('member_tiers', { code, name, sort, benefits_json: JSON.stringify(benefits) });
  }
}

function rate(planId: number, cfg: Partial<RateConfig>, from = '2020-01-01T00:00:00.000Z') {
  q.insert('rate_plan_versions', { plan_id: planId, effective_from: from, config_json: JSON.stringify({ ...DEFAULT_RATE, ...cfg }), note: 'initial' });
}

function device(type: string, name: string, siteId: number, gateId: number | null, key: string | null, connection: object = {}, settings: object = {}) {
  return q.insert('devices', {
    type,
    name,
    site_id: siteId,
    gate_id: gateId,
    api_key_hash: key ? sha256(key) : null,
    connection_json: JSON.stringify(connection),
    settings_json: JSON.stringify(settings),
  });
}

function seedDemo() {
  const site = q.insert('sites', { code: 'HQ', name: 'PP Group Plaza', address: 'Bangkok', capacity: 500 });
  const zoneA = q.insert('zones', { site_id: site, name: 'Zone A (B1)', capacity: 300 });
  q.insert('zones', { site_id: site, name: 'Zone B (B2)', capacity: 200 });
  const entry = q.insert('gates', { site_id: site, zone_id: zoneA, name: 'ทางเข้า 1', direction: 'ENTRY', settings_json: JSON.stringify({ autoIssueTicket: false }) });
  const exit = q.insert('gates', { site_id: site, zone_id: zoneA, name: 'ทางออก 1', direction: 'EXIT' });

  const edge = device('EDGE', 'Edge Agent – Gate House', site, null, DEMO_DEVICE_KEYS.EDGE, {});
  device('CAMERA', 'กล้อง LPR ทางเข้า 1', site, entry, DEMO_DEVICE_KEYS['ENTRY-CAM'], { protocol: 'rtsp', rtspUrl: 'rtsp://10.0.10.11/stream1', onvif: { host: '10.0.10.11', port: 80 }, edgeDeviceId: edge }, {
    zones: [
      { name: 'กระจกหน้า', rect: { x: 0.2, y: 0.1, w: 0.6, h: 0.4 }, expect: 'PAPER_SIGN' },
      { name: 'ป้ายหน้า', rect: { x: 0.25, y: 0.55, w: 0.5, h: 0.4 }, expect: 'REAL_PLATE' },
    ],
  });
  device('CAMERA', 'กล้อง LPR ทางออก 1', site, exit, DEMO_DEVICE_KEYS['EXIT-CAM'], { protocol: 'rtsp', rtspUrl: 'rtsp://10.0.10.12/stream1', edgeDeviceId: edge });
  device('PRINTER', 'เครื่องพิมพ์บัตร ทางเข้า 1', site, entry, null, { mode: 'bridge', bridgeUrl: 'http://127.0.0.1:9110', paperWidth: '80' });
  device('PRINTER', 'เครื่องพิมพ์ใบเสร็จ ทางออก 1', site, exit, null, { mode: 'bridge', bridgeUrl: 'http://127.0.0.1:9110', paperWidth: '80' });
  device('BARRIER', 'ไม้กั้น ทางเข้า 1', site, entry, null, { mode: 'edge', edgeDeviceId: edge });
  device('BARRIER', 'ไม้กั้น ทางออก 1', site, exit, null, { mode: 'edge', edgeDeviceId: edge });
  device('ENTRY_KIOSK', 'Kiosk ทางเข้า 1', site, entry, DEMO_DEVICE_KEYS['ENTRY-KIOSK']);
  device('EXIT_KIOSK', 'Kiosk ทางออก 1', site, exit, DEMO_DEVICE_KEYS['EXIT-KIOSK']);
  device('PAYMENT_KIOSK', 'Payment Kiosk ชั้น G', site, null, DEMO_DEVICE_KEYS['PAY-KIOSK'], { cashAcceptor: false });
  device('COUNTER', 'ประชาสัมพันธ์ ชั้น G', site, null, DEMO_DEVICE_KEYS.COUNTER);

  // Rate plans (matches the specification examples)
  const plans: Array<[string, string, Partial<RateConfig>]> = [
    ['รถยนต์', 'CAR', { freeMinutes: 120, hourlyRate: 20, dailyMax: 300, lostTicketFee: 200 }],
    ['รถจักรยานยนต์', 'MOTORCYCLE', { freeMinutes: 60, hourlyRate: 10, dailyMax: 100, lostTicketFee: 100 }],
    ['รถตู้', 'VAN', { freeMinutes: 60, hourlyRate: 30, dailyMax: 400 }],
    ['VIP', 'VIP', { freeMinutes: 240, hourlyRate: 10 }],
    ['รถบรรทุก', 'TRUCK', { freeMinutes: 30, hourlyRate: 50, firstPeriod: { minutes: 60, price: 80 } }],
  ];
  for (const [name, vt, cfg] of plans) {
    const id = q.insert('rate_plans', { site_id: site, name, vehicle_type: vt, priority: 0 });
    rate(id, cfg);
  }

  // Validation rules (global tiers + merchant-specific + weekend campaign)
  const rule = (name: string, scope: string, cfg: object, priority = 0, combinable = true) =>
    q.insert('validation_rules', { name, scope, config_json: JSON.stringify(cfg), priority, combinable: combinable ? 1 : 0 });
  rule('ยอดซื้อขั้นบันได (ทั้งศูนย์)', 'GLOBAL', {
    kind: 'TIER',
    tiers: [
      { minSpend: 300, reward: { type: 'AMOUNT', value: 20 } },
      { minSpend: 500, reward: { type: 'AMOUNT', value: 40 } },
      { minSpend: 1000, reward: { type: 'AMOUNT', value: 100 } },
      { minSpend: 2000, reward: { type: 'MINUTES', value: 180 } },
      { minSpend: 3000, reward: { type: 'FULL' } },
    ],
  });
  rule('Weekend Parking Promotion', 'CAMPAIGN', { kind: 'TIER', daysOfWeek: [0, 6], tiers: [{ minSpend: 1500, reward: { type: 'FULL' } }] }, 10, false);

  // Demo merchant (already approved)
  const merchant = q.insert('merchants', {
    code: 'M000124',
    name: 'ABC Coffee',
    owner_first_name: 'สมชาย',
    owner_last_name: 'ใจดี',
    phone: '0812345678',
    email: 'abc@example.com',
    category: 'CAFE',
    unit_no: 'G-12',
    zone: 'A',
    floor: 'G',
    site_id: site,
    status: 'ACTIVE',
    verification_key: crypto.randomBytes(24).toString('base64url'),
    receipt_info_json: JSON.stringify({ header: 'ABC Coffee สาขา PP Plaza', footer: 'ขอบคุณที่ใช้บริการ', vatRegistered: true, taxId: '0105555000000', vatMode: 'INCLUDED', serviceChargePercent: 0 }),
    approved_at: new Date().toISOString(),
  });
  q.insert('merchant_branches', { merchant_id: merchant, code: 'B01', name: 'PP Plaza', site_id: site });
  const supermarket = q.insert('merchants', {
    code: 'M000125', name: 'Fresh Supermarket', owner_first_name: 'Anan', owner_last_name: 'S.', phone: '0899999999', email: 'fresh@example.com',
    category: 'SUPERMARKET', unit_no: 'B1-01', site_id: site, status: 'ACTIVE', verification_key: crypto.randomBytes(24).toString('base64url'), approved_at: new Date().toISOString(),
  });
  q.insert('merchant_branches', { merchant_id: supermarket, code: 'B01', name: 'PP Plaza', site_id: site });
  q.insert('merchants', {
    name: 'Noodle House', owner_first_name: 'Malee', owner_last_name: 'K.', phone: '0877777777', email: 'noodle@example.com', category: 'RESTAURANT', unit_no: '2-05', site_id: site, status: 'PENDING',
  });
  rule('Supermarket ครบ 500 จอดฟรี 1 ชม.', 'MERCHANT', { kind: 'STEP', merchantIds: [supermarket], step: { every: 500, reward: { type: 'MINUTES', value: 60 }, max: 240 } }, 5);

  const cat = q.insert('product_categories', { merchant_id: merchant, name: 'Coffee', sort: 1 });
  const cat2 = q.insert('product_categories', { merchant_id: merchant, name: 'Bakery', sort: 2 });
  const prod = (category: number, name: string, price: number, sku: string, extra: object = {}) =>
    q.insert('products', { merchant_id: merchant, category_id: category, name, price, sku, barcode: `885${sku.replace(/\D/g, '').padStart(10, '0')}`, ...extra });
  prod(cat, 'Americano', 60, 'CF-001', { variants_json: JSON.stringify([{ name: 'Hot', price: 0 }, { name: 'Iced', price: 10 }]) });
  prod(cat, 'Latte', 65, 'CF-002', {
    variants_json: JSON.stringify([{ name: 'Hot', price: 0 }, { name: 'Iced', price: 10 }, { name: 'Frappe', price: 20 }]),
    modifiers_json: JSON.stringify([{ group: 'Sweetness', multi: false, options: [{ name: '0%', price: 0 }, { name: '50%', price: 0 }, { name: '100%', price: 0 }] }, { group: 'Extra', multi: true, options: [{ name: 'Extra shot', price: 15 }, { name: 'Oat milk', price: 20 }] }]),
  });
  prod(cat, 'Mocha', 70, 'CF-003');
  prod(cat2, 'Croissant', 55, 'BK-001');
  prod(cat2, 'Cheesecake', 120, 'BK-002');
  device('POS', 'POS ABC Coffee #1', site, null, DEMO_DEVICE_KEYS.POS);
  q.run('UPDATE devices SET merchant_id=? WHERE type=?', merchant, 'POS');

  const user = (username: string, name: string, role: string, extra: object = {}) =>
    q.insert('users', { username, display_name: name, password_hash: hashPassword('demo1234'), pin_hash: hashPassword('1234'), role, ...extra });
  user('admin', 'ผู้ดูแลระบบ', 'ADMIN');
  user('manager', 'ผู้จัดการลานจอด', 'MANAGER');
  user('info', 'ประชาสัมพันธ์', 'INFORMATION');
  user('cashier', 'แคชเชียร์', 'CASHIER');
  user('staff', 'เจ้าหน้าที่ลานจอด', 'PARKING_STAFF');
  user('auditor', 'ผู้ตรวจสอบ', 'AUDITOR');
  const branch = q.get<{ id: number }>('SELECT id FROM merchant_branches WHERE merchant_id=?', merchant)!.id;
  user('abc.owner', 'ABC Owner', 'MERCHANT_OWNER', { merchant_id: merchant, branch_id: branch });
  user('abc.cashier', 'ABC Cashier', 'MERCHANT_CASHIER', { merchant_id: merchant, branch_id: branch });
  const fbranch = q.get<{ id: number }>('SELECT id FROM merchant_branches WHERE merchant_id=?', supermarket)!.id;
  user('fresh.owner', 'Fresh Owner', 'MERCHANT_OWNER', { merchant_id: supermarket, branch_id: fbranch });

  // Members & lists
  const m = q.insert('members', { phone: '0811111111', first_name: 'Somsri', last_name: 'R.', tier: 'GOLD', consent_at: new Date().toISOString() });
  q.insert('member_vehicles', { member_id: m, plate_prefix: '1กข', plate_number: '9999', province: '10', plate_key: '1กข|9999|10' });
  q.insert('passes', { type: 'STAFF', holder_name: 'พนักงาน ศูนย์', plate_key: 'ฮฮ|1|10', plate_text: 'ฮฮ 1', province: '10', site_id: site, valid_from: '2020-01-01T00:00:00Z', valid_to: '2099-12-31T00:00:00Z', ticketless: 1, free_parking: 1 });
  q.insert('plate_lists', { list_type: 'BLACKLIST', plate_key: 'ขข|6666|20', plate_text: 'ขข 6666', province: '20', reason: 'ค้างชำระ/ก่อเหตุ' });
  q.insert('holidays', { date: '2026-10-13', name: 'วันนวมินทรมหาราช' });
  q.insert('holidays', { date: '2026-10-23', name: 'วันปิยมหาราช' });

  console.log('Demo device keys (X-Device-Key):', DEMO_DEVICE_KEYS);
  console.log('Demo users (password demo1234, PIN 1234): admin, manager, info, cashier, staff, auditor, abc.owner, abc.cashier, fresh.owner');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  db();
  ensureSeed();
}
