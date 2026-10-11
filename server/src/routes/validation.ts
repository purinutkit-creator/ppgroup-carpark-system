/**
 * Information Counter / Payment Kiosk receipt validation.
 *   POST /api/validation/lookup      find vehicle (QR, parking no, plate+province)
 *   POST /api/validation/receipt     verify one receipt (server truth)
 *   POST /api/validation/preview     reward calculation without saving
 *   POST /api/validation/apply       confirm → discount saved, customer page updates
 *   POST /api/validation/calculator  stamp calculator (purchase amount → reward)
 */
import { Router, type Request } from 'express';
import { evaluateRewards } from '@pp/shared';
import { body, h, HttpError, num, str, forbidden } from '../lib/http.ts';
import { can, requireUserOrDevice } from '../auth/middleware.ts';
import { audit } from '../lib/audit.ts';
import { getSetting } from '../lib/settings.ts';
import { applyValidation, loadRules, previewValidation, verifyReceipt, type ExternalReceipt } from '../services/validation.ts';
import { findSessions } from '../services/lookup.ts';
import { getSession, quote, sessionSummary } from '../services/sessions.ts';

export const router = Router();
const guard = requireUserOrDevice(['validation.apply'], ['PAYMENT_KIOSK', 'COUNTER']);
router.use(guard);

function channel(req: Request): 'COUNTER' | 'KIOSK' {
  return req.device?.type === 'PAYMENT_KIOSK' ? 'KIOSK' : 'COUNTER';
}

function externalFrom(req: Request): ExternalReceipt[] {
  const ext = (body(req).external ?? []) as ExternalReceipt[];
  if (!Array.isArray(ext) || !ext.length) return [];
  if (channel(req) === 'KIOSK') throw forbidden('EXTERNAL_RECEIPTS_COUNTER_ONLY');
  if (!can(req, 'validation.manual_amount') && !getSetting('validation').allowManualAmountEntry) throw forbidden('MANUAL_AMOUNT_NOT_ALLOWED');
  return ext.map((e) => {
    if (!e.ref || !(Number(e.amount) > 0)) throw new HttpError(400, 'VALIDATION', 'external receipt needs ref and amount');
    return { ref: String(e.ref).trim().slice(0, 60), amount: Number(e.amount), merchantId: e.merchantId ?? null };
  });
}

router.post(
  '/lookup',
  h((req, res) => {
    const b = body(req);
    const rows = findSessions({
      code: str(b, 'code'),
      parkingNo: str(b, 'parkingNo'),
      plate: str(b, 'plate'),
      prefix: str(b, 'prefix'),
      number: str(b, 'number'),
      province: str(b, 'province'),
      siteId: req.device?.siteId ?? null,
    });
    // Kiosk users only see minimal data; counters get the full summary.
    res.json({ items: rows.map((s) => ({ ...sessionSummary(s), quote: quote(s) })) });
  }),
);

router.post(
  '/receipt',
  h((req, res) => {
    const b = body(req);
    const sessionId = num(b, 'sessionId');
    const siteId = sessionId ? getSession(sessionId).site_id : (req.device?.siteId ?? null);
    const allowNoToken = channel(req) === 'COUNTER' && can(req, 'validation.override') && b.allowWithoutToken === true;
    res.json(verifyReceipt(String(b.code ?? ''), { siteId, requireToken: !allowNoToken }));
  }),
);

router.post(
  '/preview',
  h((req, res) => {
    const b = body(req);
    const sessionId = num(b, 'sessionId', { required: true })!;
    const codes = Array.isArray(b.codes) ? (b.codes as string[]).map(String) : [];
    res.json(previewValidation(sessionId, codes, externalFrom(req), { channel: channel(req) }));
  }),
);

router.post(
  '/apply',
  h((req, res) => {
    const b = body(req);
    const sessionId = num(b, 'sessionId', { required: true })!;
    const codes = Array.isArray(b.codes) ? (b.codes as string[]).map(String) : [];
    const external = externalFrom(req);
    const r = applyValidation({
      sessionId,
      codes,
      external,
      channel: channel(req) === 'KIOSK' ? 'KIOSK' : 'COUNTER',
      counter: str(b, 'counter') ?? req.device?.name ?? null,
      deviceId: req.device?.id ?? null,
      userId: req.user?.id ?? null,
    });
    const s = r.session;
    for (const rc of r.preview.receipts) {
      audit(req, {
        action: 'validation.receipt',
        entityType: 'receipt',
        entityId: rc.receipt!.receiptNo,
        receiptNo: rc.receipt!.receiptNo,
        merchantId: rc.receipt!.merchantId,
        sessionId: s.id,
        parkingNo: s.parking_no,
        siteId: s.site_id,
        after: { amount: rc.receipt!.total, plate: s.plate_text, province: s.province, discountId: r.discountId, rules: r.preview.reward.applied.map((a) => a.ruleName) },
      });
    }
    for (const e of external) {
      audit(req, { action: 'validation.manual_stamp', entityType: 'receipt', entityId: `EXT:${e.ref}`, receiptNo: e.ref, sessionId: s.id, parkingNo: s.parking_no, after: e });
    }
    res.json({ ok: true, discountId: r.discountId, reward: r.preview.reward, quote: r.quote });
  }),
);

/** Stamp calculator: what would this purchase amount earn now (no session needed). */
router.post(
  '/calculator',
  h((req, res) => {
    const b = body(req);
    const amount = num(b, 'amount', { required: true, min: 0 })!;
    const merchantId = num(b, 'merchantId') ?? null;
    const r = evaluateRewards([{ receiptRef: 'calc', merchantId, amount }], loadRules(), (rw) => (rw.type === 'FULL' ? 1e6 : rw.type === 'AMOUNT' ? rw.value : rw.value / 3), { now: new Date() });
    res.json(r);
  }),
);

router.get('/settings', h((_req, res) => res.json({ settings: getSetting('validation'), rules: loadRules() })));
