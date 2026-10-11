/**
 * Staff session management: search, details, plate correction, manual
 * discount / waiver (with approval), lost ticket, cancel, cash, refund,
 * LPR review queue, tax documents.
 */
import { Router } from 'express';
import QRCode from 'qrcode';
import { manualPlate, provinceByCode } from '@pp/shared';
import { q, json, nowIso, tx } from '../db/index.ts';
import { body, bool, h, HttpError, int, num, paging, reqStr, str, oneOf, notFound, r2 } from '../lib/http.ts';
import { requirePerm, verifyApproval, assertSite, can } from '../auth/middleware.ts';
import { audit } from '../lib/audit.ts';
import { resolveAlerts } from '../lib/alerts.ts';
import { getSetting } from '../lib/settings.ts';
import { privateFilePath } from '../lib/files.ts';
import { nextSequence, ymd } from '../lib/sequence.ts';
import {
  closeSession,
  customerUrl,
  getSession,
  quote,
  refreshPaymentStatus,
  rotateToken,
  sessionSummary,
  broadcastSession,
} from '../services/sessions.ts';
import { detectionView, correctDetection } from '../services/detections.ts';
import { payCash, paymentsForSession, refundPayment } from '../services/payments.ts';
import { sessionValidations } from '../services/validation.ts';
import { findSessions } from '../services/lookup.ts';
import { ticketPayload } from '../services/gates.ts';

export const router = Router();

router.get(
  '/',
  requirePerm('sessions.view'),
  h((req, res) => {
    const { limit, offset } = paging(req);
    const where: string[] = [];
    const params: unknown[] = [];
    const Q = req.query as Record<string, string>;
    if (Q.status) (where.push('s.status=?'), params.push(Q.status));
    if (Q.paymentStatus) (where.push('s.payment_status=?'), params.push(Q.paymentStatus));
    if (Q.siteId) (where.push('s.site_id=?'), params.push(Number(Q.siteId)));
    if (Q.from) (where.push('s.entry_at>=?'), params.push(Q.from));
    if (Q.to) (where.push('s.entry_at<=?'), params.push(Q.to));
    if (Q.gateId) (where.push('(s.entry_gate_id=? OR s.exit_gate_id=?)'), params.push(Number(Q.gateId), Number(Q.gateId)));
    if (Q.cameraId) (where.push('s.entry_detection_id IN (SELECT id FROM detections WHERE camera_id=?)'), params.push(Number(Q.cameraId)));
    if (Q.province) (where.push('s.province=?'), params.push(Q.province));
    if (Q.flag) (where.push('s.flags LIKE ?'), params.push(`%${Q.flag}%`));
    if (Q.q) {
      const term = Q.q.trim().replace(/\s+/g, '');
      where.push("(s.parking_no LIKE ? OR REPLACE(s.plate_text,' ','') LIKE ?)");
      params.push(`%${term.toUpperCase()}%`, `%${term}%`);
    }
    const scope = req.user!.siteIds;
    if (scope) where.push(`s.site_id IN (${scope.map(Number).join(',') || 0})`);
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = q.get<{ n: number }>(`SELECT COUNT(*) n FROM parking_sessions s ${w}`, ...params)!.n;
    const rows = q.all(`SELECT s.* FROM parking_sessions s ${w} ORDER BY s.entry_at DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
    res.json({
      total,
      items: rows.map((s) => {
        const sum = sessionSummary(s);
        if (s.status === 'ACTIVE') {
          const qt = quote(s);
          return { ...sum, due: qt.due, net: qt.net, gross: qt.gross };
        }
        return sum;
      }),
    });
  }),
);

router.get(
  '/find',
  requirePerm('sessions.view', 'validation.apply'),
  h((req, res) => {
    const Q = req.query as Record<string, string>;
    const rows = findSessions({ code: Q.code, parkingNo: Q.parkingNo, plate: Q.plate, prefix: Q.prefix, number: Q.number, province: Q.province, includeClosed: Q.includeClosed === '1' });
    res.json({ items: rows.map((s) => ({ ...sessionSummary(s), quote: s.status === 'ACTIVE' ? quote(s) : null })) });
  }),
);

router.get(
  '/review',
  requirePerm('lpr.review'),
  h((req, res) => {
    const status = String(req.query.status ?? 'PENDING');
    const rows = q.all('SELECT * FROM detections WHERE review_status=? ORDER BY captured_at DESC LIMIT 200', status);
    res.json({ items: rows.map(detectionView) });
  }),
);

router.get(
  '/detections/:id',
  requirePerm('lpr.review', 'sessions.view'),
  h((req, res) => {
    const d = q.get('SELECT * FROM detections WHERE id=?', Number(req.params.id));
    if (!d) throw notFound();
    res.json({ detection: detectionView(d) });
  }),
);

/** Resolve a review item: pick a candidate or type the plate / province. Updates the linked session too. */
router.post(
  '/detections/:id/correct',
  requirePerm('lpr.review'),
  h((req, res) => {
    const b = body(req);
    const r = correctDetection(
      Number(req.params.id),
      { prefix: String(b.prefix ?? ''), number: String(b.number ?? ''), province: str(b, 'province') ?? null, candidateIndex: int(b, 'candidateIndex'), sourceType: str(b, 'sourceType') },
      req.user!.id,
    );
    if (r.detection.session_id) {
      const s = getSession(r.detection.session_id);
      updateSessionPlate(s.id, r.plate, r.after.sourceType);
      audit(req, { action: 'session.plate_corrected', entityType: 'session', entityId: s.id, sessionId: s.id, parkingNo: s.parking_no, siteId: s.site_id, before: r.before, after: r.after, reason: str(b, 'reason') ?? 'LPR review' });
    } else {
      audit(req, { action: 'lpr.corrected', entityType: 'detection', entityId: r.detection.id, siteId: r.detection.site_id, before: r.before, after: r.after });
    }
    res.json({ detection: detectionView(r.detection) });
  }),
);

router.post(
  '/detections/:id/dismiss',
  requirePerm('lpr.review'),
  h((req, res) => {
    const id = Number(req.params.id);
    q.run("UPDATE detections SET review_status='DISMISSED', corrected_by=?, corrected_at=? WHERE id=?", req.user!.id, nowIso(), id);
    resolveAlerts(`LPR_REVIEW:${id}`);
    audit(req, { action: 'lpr.dismissed', entityType: 'detection', entityId: id, reason: str(body(req), 'reason') ?? null });
    res.json({ ok: true });
  }),
);

/** Serve private LPR images (permission + audit for PDPA). */
router.get(
  '/images',
  requirePerm('images.view'),
  h((req, res) => {
    const rel = String(req.query.path ?? '');
    const abs = privateFilePath(rel);
    if (!abs) throw notFound();
    audit(req, { action: 'pdpa.image_view', entityType: 'image', entityId: rel });
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.sendFile(abs);
  }),
);

function updateSessionPlate(sessionId: number, p: ReturnType<typeof manualPlate>, source: string) {
  q.run(
    'UPDATE parking_sessions SET plate_prefix=?, plate_number=?, province=?, plate_text=?, plate_key=?, plate_source=?, unread_plate=0, updated_at=? WHERE id=?',
    p.prefix,
    p.number,
    p.provinceCode,
    p.plateText,
    p.key,
    source,
    nowIso(),
    sessionId,
  );
  broadcastSession(getSession(sessionId));
}

router.get(
  '/:id',
  requirePerm('sessions.view'),
  h((req, res) => {
    const s = getSession(Number(req.params.id));
    assertSite(req, s.site_id);
    const detections = q.all('SELECT * FROM detections WHERE session_id=? OR id IN (?,?) ORDER BY captured_at', s.id, s.entry_detection_id ?? 0, s.exit_detection_id ?? 0).map(detectionView);
    const discounts = q.all('SELECT d.*, u.display_name created_by_name, a.display_name approved_by_name FROM parking_discounts d LEFT JOIN users u ON u.id=d.created_by LEFT JOIN users a ON a.id=d.approved_by WHERE session_id=? ORDER BY id', s.id).map((d) => ({ ...d, rules: json(d.rules_json, []) }));
    const logs = can(req, 'audit.view') ? q.all('SELECT * FROM audit_logs WHERE session_id=? ORDER BY at DESC LIMIT 200', s.id) : [];
    const gates = q.all('SELECT id, name, direction FROM gates WHERE id IN (?,?)', s.entry_gate_id ?? 0, s.exit_gate_id ?? 0);
    res.json({
      session: sessionSummary(s),
      quote: quote(s),
      detections,
      discounts,
      validations: sessionValidations(s.id),
      payments: paymentsForSession(s.id),
      taxDocuments: q.all('SELECT t.* FROM tax_documents t JOIN payments p ON p.id=t.payment_id WHERE p.session_id=?', s.id),
      audit: logs,
      gates,
    });
  }),
);

router.post(
  '/:id/plate',
  requirePerm('sessions.edit'),
  h((req, res) => {
    const s = getSession(Number(req.params.id));
    assertSite(req, s.site_id);
    const b = body(req);
    const reason = reqStr(b, 'reason');
    const p = manualPlate(reqStr(b, 'prefix', 5), reqStr(b, 'number', 5), str(b, 'province') ?? null);
    const before = { plate: s.plate_text, province: s.province, key: s.plate_key, vehicleType: s.vehicle_type };
    updateSessionPlate(s.id, p, 'MANUAL_ENTRY');
    const vt = str(b, 'vehicleType');
    if (vt) q.run('UPDATE parking_sessions SET vehicle_type=? WHERE id=?', vt, s.id);
    audit(req, {
      action: before.province !== p.provinceCode && before.plate === p.plateText ? 'session.province_changed' : 'session.plate_changed',
      entityType: 'session',
      entityId: s.id,
      sessionId: s.id,
      parkingNo: s.parking_no,
      siteId: s.site_id,
      before,
      after: { plate: p.plateText, province: p.provinceCode, key: p.key, vehicleType: vt ?? s.vehicle_type },
      reason,
    });
    res.json({ session: sessionSummary(getSession(s.id)) });
  }),
);

/** Manual discount / stamp / waiver. Waivers and discounts above the threshold need an approver. */
router.post(
  '/:id/discounts',
  requirePerm('discount.manual', 'waive.create', 'validation.manual_amount'),
  h((req, res) => {
    const s = getSession(Number(req.params.id));
    assertSite(req, s.site_id);
    if (s.status !== 'ACTIVE') throw new HttpError(409, 'SESSION_NOT_ACTIVE');
    const b = body(req);
    const type = oneOf(b, 'type', ['MANUAL_DISCOUNT', 'WAIVER', 'MANUAL_STAMP', 'PROMOTION'] as const, true)!;
    const reason = reqStr(b, 'reason');
    const amount = num(b, 'amount', { min: 0 }) ?? 0;
    const freeMinutes = int(b, 'freeMinutes', { min: 0 }) ?? 0;
    const full = type === 'WAIVER' || !!bool(b, 'full');
    let approval = null;
    if (type === 'WAIVER') {
      if (!can(req, 'waive.create')) throw new HttpError(403, 'FORBIDDEN');
      approval = verifyApproval(req, b.approval as any, 'waive.approve');
    } else if (type === 'MANUAL_STAMP') {
      if (!can(req, 'validation.manual_amount') && !getSetting('validation').allowManualAmountEntry) throw new HttpError(403, 'FORBIDDEN');
    } else {
      if (!can(req, 'discount.manual')) throw new HttpError(403, 'FORBIDDEN');
      approval = verifyApproval(req, b.approval as any, 'discount.approve');
    }
    if (!full && amount <= 0 && freeMinutes <= 0) throw new HttpError(400, 'EMPTY_DISCOUNT');
    const before = quote(s);
    const id = q.insert('parking_discounts', {
      session_id: s.id,
      type,
      amount,
      free_minutes: freeMinutes,
      full_waiver: full ? 1 : 0,
      source: 'ADMIN',
      reason,
      created_by: req.user!.id,
      approved_by: approval?.userId ?? null,
    });
    const after = refreshPaymentStatus(s.id);
    audit(req, {
      action: type === 'WAIVER' ? 'parking.waive' : type === 'MANUAL_STAMP' ? 'parking.manual_stamp' : 'parking.manual_discount',
      entityType: 'discount',
      entityId: id,
      sessionId: s.id,
      parkingNo: s.parking_no,
      siteId: s.site_id,
      before: { net: before.net, due: before.due },
      after: { net: after.net, due: after.due, amount, freeMinutes, full },
      reason,
      approvedBy: approval,
    });
    res.json({ quote: after });
  }),
);

router.post(
  '/:id/discounts/:discountId/revoke',
  requirePerm('discount.approve', 'validation.override'),
  h((req, res) => {
    const s = getSession(Number(req.params.id));
    const d = q.get('SELECT * FROM parking_discounts WHERE id=? AND session_id=?', Number(req.params.discountId), s.id);
    if (!d) throw notFound();
    const reason = reqStr(body(req), 'reason');
    tx(() => {
      q.run("UPDATE parking_discounts SET status='REVOKED', revoked_at=?, revoked_by=?, revoked_reason=? WHERE id=?", nowIso(), req.user!.id, reason, d.id);
      // Receipts become reusable only if explicitly released.
      if (bool(body(req), 'releaseReceipts')) {
        for (const u of q.all('SELECT * FROM receipt_usages WHERE discount_id=?', d.id)) {
          q.run('DELETE FROM receipt_usages WHERE id=?', u.id);
          if (u.sale_id) q.run("UPDATE pos_sales SET parking_validation_status='NOT_USED' WHERE id=?", u.sale_id);
        }
      } else q.run("UPDATE receipt_usages SET status='REVOKED' WHERE discount_id=? AND status='VALIDATED'", d.id);
    });
    const after = refreshPaymentStatus(s.id);
    audit(req, { action: 'validation.override', entityType: 'discount', entityId: d.id, sessionId: s.id, parkingNo: s.parking_no, before: d, after: { status: 'REVOKED' }, reason });
    res.json({ quote: after });
  }),
);

router.post(
  '/:id/lost-ticket',
  requirePerm('sessions.lost_ticket'),
  h((req, res) => {
    const s = getSession(Number(req.params.id));
    assertSite(req, s.site_id);
    if (s.status !== 'ACTIVE') throw new HttpError(409, 'SESSION_NOT_ACTIVE');
    const b = body(req);
    const reason = reqStr(b, 'reason');
    const charge = bool(b, 'chargeFee') ?? true;
    if (charge) q.run('UPDATE parking_sessions SET lost_ticket=1 WHERE id=?', s.id);
    const token = rotateToken(s.id); // old ticket QR is invalidated
    const fresh = getSession(s.id);
    audit(req, { action: 'session.lost_ticket_reissue', entityType: 'session', entityId: s.id, sessionId: s.id, parkingNo: s.parking_no, reason, after: { chargeFee: charge, tokenVersion: fresh.token_version } });
    broadcastSession(fresh);
    res.json({ ticket: ticketPayload(fresh, token), quote: quote(fresh) });
  }),
);

/** Reprint (rotates the token — only the latest printed ticket works). */
router.post(
  '/:id/reprint',
  requirePerm('sessions.edit', 'sessions.lost_ticket'),
  h((req, res) => {
    const s = getSession(Number(req.params.id));
    if (s.status !== 'ACTIVE') throw new HttpError(409, 'SESSION_NOT_ACTIVE');
    const token = rotateToken(s.id);
    audit(req, { action: 'session.ticket_reprint', entityType: 'session', entityId: s.id, sessionId: s.id, parkingNo: s.parking_no, reason: str(body(req), 'reason') ?? null });
    res.json({ ticket: ticketPayload(getSession(s.id), token) });
  }),
);

router.post(
  '/:id/cancel',
  requirePerm('sessions.cancel'),
  h((req, res) => {
    const s = getSession(Number(req.params.id));
    const reason = reqStr(body(req), 'reason');
    const approval = verifyApproval(req, body(req).approval as any, 'discount.approve');
    q.run("UPDATE parking_sessions SET status='CANCELLED', token_hash=NULL, exit_at=?, updated_at=? WHERE id=? AND status='ACTIVE'", nowIso(), nowIso(), s.id);
    audit(req, { action: 'session.cancel', entityType: 'session', entityId: s.id, sessionId: s.id, parkingNo: s.parking_no, reason, approvedBy: approval });
    broadcastSession(getSession(s.id));
    res.json({ session: sessionSummary(getSession(s.id)) });
  }),
);

/** Force close (vehicle left without passing the gate logic, e.g. barrier fault). */
router.post(
  '/:id/close',
  requirePerm('gate.open_manual'),
  h((req, res) => {
    const s = getSession(Number(req.params.id));
    const reason = reqStr(body(req), 'reason');
    const approval = verifyApproval(req, body(req).approval as any, 'gate.open_manual');
    const qt = quote(s);
    const closed = closeSession(s.id, { reason });
    audit(req, { action: 'session.force_close', entityType: 'session', entityId: s.id, sessionId: s.id, parkingNo: s.parking_no, reason, approvedBy: approval, before: { due: qt.due } });
    res.json({ session: sessionSummary(closed) });
  }),
);

router.post(
  '/:id/pay-cash',
  requirePerm('payment.cash'),
  h((req, res) => {
    const s = getSession(Number(req.params.id));
    assertSite(req, s.site_id);
    const b = body(req);
    const p = payCash({ sessionId: s.id, received: num(b, 'received', { required: true, min: 0 })!, userId: req.user!.id, channel: 'COUNTER', idempotencyKey: str(b, 'idempotencyKey') ?? null });
    audit(req, { action: 'payment.cash', entityType: 'payment', entityId: p.id, sessionId: s.id, parkingNo: s.parking_no, after: p });
    res.json({ payment: p, quote: quote(getSession(s.id)) });
  }),
);

router.post(
  '/:id/payments/:paymentId/refund',
  requirePerm('payment.refund'),
  h(async (req, res) => {
    const s = getSession(Number(req.params.id));
    const b = body(req);
    const reason = reqStr(b, 'reason');
    const approval = verifyApproval(req, b.approval as any, 'payment.refund_approve', { allowSelf: false });
    const p = await refundPayment({ paymentId: Number(req.params.paymentId), amount: num(b, 'amount', { required: true, min: 0.01 })!, reason, userId: req.user!.id, approvedBy: approval.userId });
    audit(req, { action: 'payment.refund', entityType: 'payment', entityId: p.id, sessionId: s.id, parkingNo: s.parking_no, reason, approvedBy: approval, after: { refunded: p.refunded_amount, status: p.status } });
    res.json({ payment: p });
  }),
);

/** Receipt / abbreviated or full tax invoice for a paid parking payment. */
router.post(
  '/:id/payments/:paymentId/tax-document',
  requirePerm('tax.issue'),
  h((req, res) => {
    const s = getSession(Number(req.params.id));
    const p = q.get("SELECT * FROM payments WHERE id=? AND session_id=? AND status IN ('PAID','PARTIALLY_REFUNDED')", Number(req.params.paymentId), s.id);
    if (!p) throw notFound('PAYMENT_NOT_FOUND');
    const b = body(req);
    const docType = oneOf(b, 'docType', ['RECEIPT', 'TAX_INVOICE_ABB', 'TAX_INVOICE_FULL'] as const) ?? 'TAX_INVOICE_ABB';
    if (docType === 'TAX_INVOICE_FULL' && (!b.buyerName || !b.buyerTaxId)) throw new HttpError(400, 'BUYER_REQUIRED');
    const existing = q.get('SELECT * FROM tax_documents WHERE payment_id=? AND doc_type=?', p.id, docType);
    if (existing) return res.json({ document: existing, reprint: true, company: getSetting('receipt') });
    const vatRate = getSetting('payment').vatRate;
    const vat = r2((p.amount * vatRate) / (100 + vatRate));
    const prefix = docType === 'RECEIPT' ? 'RC' : docType === 'TAX_INVOICE_ABB' ? 'TA' : 'TF';
    const day = ymd(new Date());
    const docNo = `${prefix}${day}${String(nextSequence(`tax:${prefix}`, day)).padStart(5, '0')}`;
    const id = q.insert('tax_documents', {
      doc_no: docNo,
      doc_type: docType,
      payment_id: p.id,
      buyer_name: str(b, 'buyerName') ?? null,
      buyer_tax_id: str(b, 'buyerTaxId') ?? null,
      buyer_address: str(b, 'buyerAddress') ?? null,
      buyer_branch: str(b, 'buyerBranch') ?? null,
      amount: p.amount,
      vat,
      created_by: req.user!.id,
    });
    audit(req, { action: 'tax.issue', entityType: 'tax_document', entityId: id, sessionId: s.id, parkingNo: s.parking_no, after: { docNo, docType } });
    res.json({ document: q.get('SELECT * FROM tax_documents WHERE id=?', id), company: getSetting('receipt') });
  }),
);

router.get(
  '/:id/ticket-qr',
  requirePerm('sessions.view'),
  h(async (req, res) => {
    // Never reveals the token; issues a new one only via /reprint. Returns QR for parking no lookup.
    const s = getSession(Number(req.params.id));
    res.json({ dataUrl: await QRCode.toDataURL(s.parking_no) });
  }),
);

export { customerUrl, provinceByCode };
