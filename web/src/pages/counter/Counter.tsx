/**
 * Information Counter (/counter): find the car (ticket QR / Parking ID /
 * plate + province), verify shop receipts (PV1.<receipt_no>.<token>),
 * preview the parking reward and apply it. Also cash payment, lost-ticket
 * reissue and a stamp calculator. Keyboard first: scanners work without a
 * focused field, Enter submits, Esc clears, F2 / F4 jump to the inputs.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import '../../kiosk.css';
import { get, post } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { dateTime, money, time } from '../../lib/format';
import { useSocketEvents } from '../../lib/useSocket';
import { useDesign } from '../../design/DesignProvider';
import { printDoc } from '../../print/print';
import { Badge, Button, Card, Check, Empty, Input, NumberInput, ProvinceSelect, errorText, useToast } from '../../components/ui';
import { useNow } from '../../components/kiosk/hooks';
import { deThai, useScanner } from '../../components/kiosk/useScanner';
import { CameraScanner, cameraScanSupported } from '../../components/kiosk/CameraScanner';
import { PlateBox } from '../../components/kiosk/KioskUi';
import { blockingText, rewardText } from '../../components/kiosk/receiptReasons';
import { ReceiptCard } from '../../components/kiosk/counter/ReceiptCard';
import { CashDialog, LostTicketDialog, StampCalculator } from '../../components/kiosk/counter/CounterTools';
import { validationSlipDoc } from '../../components/kiosk/counter/validationSlip';
import type { ExternalReceipt, Quote, SessionSummary, ValidationPreview, VerifiedReceipt } from '../../components/kiosk/types';
import type { ValidationSettings } from '@pp/shared/validation';

type LookupItem = SessionSummary & { quote: Quote };
interface ScannedReceipt {
  code: string;
  result: VerifiedReceipt;
}

const T = 'info-counter/main/section/title';
const isReceiptCode = (c: string) => /^PV1[.:]/i.test(c) || /[?&]r=PV1/i.test(c);

export default function Counter() {
  const { user, can, logout } = useAuth();
  const toast = useToast();
  const design = useDesign();
  const now = useNow(1000);
  const [settings, setSettings] = useState<ValidationSettings | null>(null);
  const [q, setQ] = useState('');
  const [province, setProvince] = useState<string | null>(null);
  const [results, setResults] = useState<LookupItem[]>([]);
  const [sel, setSel] = useState<LookupItem | null>(null);
  const [lookupErr, setLookupErr] = useState<string | null>(null);
  const [receiptInput, setReceiptInput] = useState('');
  const [receipts, setReceipts] = useState<ScannedReceipt[]>([]);
  const [external, setExternal] = useState<ExternalReceipt[]>([]);
  const [extRef, setExtRef] = useState('');
  const [extAmount, setExtAmount] = useState<number | null>(null);
  const [preview, setPreview] = useState<ValidationPreview | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [printSlip, setPrintSlip] = useState(false);
  const [camera, setCamera] = useState<'vehicle' | 'receipt' | null>(null);
  const [dialog, setDialog] = useState<'cash' | 'lost' | null>(null);
  const vehicleRef = useRef<HTMLInputElement>(null);
  const receiptRef = useRef<HTMLInputElement>(null);
  const counterName = user?.displayName ?? 'Information Counter';

  useEffect(() => {
    get<{ settings: ValidationSettings }>('/api/validation/settings')
      .then((r) => setSettings(r.settings))
      .catch(() => {});
  }, []);

  const allowManual = !!settings?.allowManualAmountEntry || can('validation.manual_amount');
  const allowMultiple = settings?.allowMultipleReceipts ?? true;

  // ------------------------------------------------------------ lookup --
  const lookup = useCallback(async (body: Record<string, unknown>, keepSelection = false) => {
    setLookupErr(null);
    try {
      const r = await post<{ items: LookupItem[] }>('/api/validation/lookup', body);
      if (keepSelection) {
        setSel((s) => (s ? (r.items.find((i) => i.id === s.id) ?? s) : s));
        return;
      }
      setResults(r.items);
      if (r.items.length === 1) selectItem(r.items[0]);
      else {
        setSel(null);
        if (!r.items.length) setLookupErr('ไม่พบรายการจอดที่ยังไม่ออก');
      }
    } catch (e) {
      setLookupErr(errorText(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectItem = (it: LookupItem) => {
    setSel(it);
    setPreview(null);
    // receipts verified against another session are re-checked on preview
  };

  const refreshSelected = useCallback(() => {
    if (sel) lookup({ parkingNo: sel.parkingNo }, true);
  }, [sel, lookup]);

  const submitVehicle = () => {
    const v = q.trim();
    if (!v) return;
    if (isReceiptCode(deThai(v))) {
      setQ('');
      addReceipt(deThai(v));
      return;
    }
    if (/[ก-ฮ]/.test(v) && !/^https?:/i.test(v)) lookup({ plate: v, province: province ?? undefined });
    else lookup({ code: deThai(v) });
  };

  // ---------------------------------------------------------- receipts --
  const addReceipt = useCallback(
    async (code: string) => {
      const c = code.trim();
      if (!c) return;
      try {
        const result = await post<VerifiedReceipt>('/api/validation/receipt', { code: c, sessionId: sel?.id });
        setReceipts((list) => {
          const no = result.receipt?.receiptNo;
          const rest = list.filter((x) => (no ? x.result.receipt?.receiptNo !== no : x.code !== c));
          const okOthers = allowMultiple ? rest : rest.filter((x) => !x.result.ok);
          return [{ code: c, result }, ...okOthers];
        });
        if (!result.ok) toast(`ใบเสร็จใช้ไม่ได้: ${result.code}`, 'error');
      } catch (e) {
        toast(errorText(e), 'error');
      }
    },
    [sel?.id, allowMultiple, toast],
  );

  const okCodes = useMemo(() => receipts.filter((r) => r.result.ok).map((r) => r.code), [receipts]);

  // live preview
  useEffect(() => {
    setPreviewErr(null);
    if (!sel || (!okCodes.length && !external.length)) {
      setPreview(null);
      return;
    }
    let alive = true;
    const tm = setTimeout(async () => {
      try {
        const p = await post<ValidationPreview>('/api/validation/preview', { sessionId: sel.id, codes: okCodes, external });
        if (alive) setPreview(p);
      } catch (e) {
        if (alive) {
          setPreview(null);
          setPreviewErr(errorText(e));
        }
      }
    }, 150);
    return () => {
      alive = false;
      clearTimeout(tm);
    };
  }, [sel, okCodes, external]);

  const clearAll = useCallback(() => {
    setQ('');
    setResults([]);
    setSel(null);
    setReceipts([]);
    setExternal([]);
    setPreview(null);
    setLookupErr(null);
    setPreviewErr(null);
    setCamera(null);
    vehicleRef.current?.focus();
  }, []);

  const apply = async () => {
    if (!sel || !preview || preview.blocking.length || !preview.reward.applied.length) return;
    setBusy(true);
    try {
      const r = await post<{ ok: boolean; quote: Quote }>('/api/validation/apply', { sessionId: sel.id, codes: okCodes, external, counter: counterName });
      toast(`รับสิทธิ์สำเร็จ · ค่าจอดคงเหลือ ${money(r.quote.due)}`, 'success');
      if (printSlip) {
        printDoc(validationSlipDoc({ preview, after: r.quote, external, counter: counterName }), design?.config ?? null, null, { job: 'validation-slip', ref: sel.parkingNo }).catch((e) => toast(errorText(e), 'error'));
      }
      setReceipts([]);
      setExternal([]);
      setPreview(null);
      setSel((s) => (s ? { ...s, quote: r.quote } : s));
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  // scanner without a focused field: route by code type
  useScanner(
    (code) => {
      if (dialog) return;
      if (isReceiptCode(code)) addReceipt(code);
      else lookup({ code });
    },
    { enabled: !dialog },
  );

  // Esc clears, F2 vehicle, F4 receipt, Ctrl+Enter confirm
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (dialog) return;
      if (e.key === 'Escape') clearAll();
      else if (e.key === 'F2') {
        e.preventDefault();
        vehicleRef.current?.focus();
      } else if (e.key === 'F4') {
        e.preventDefault();
        receiptRef.current?.focus();
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        apply();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useSocketEvents({
    'session:update': (p: { id?: number }) => {
      if (sel && p?.id === sel.id) refreshSelected();
    },
  });

  const quote = sel?.quote ?? null;
  const elapsed = quote ? Math.max(0, (now - new Date(quote.entryAt).getTime()) / 1000) : 0;
  const canApply = !!preview && !preview.blocking.length && preview.reward.applied.length > 0 && !busy;

  return (
    <div className="ctr">
      <div className="ctr-top">
        <span className="ctr-title">Information Counter</span>
        <span className="muted">{dateTime(new Date(now).toISOString())}</span>
        <span className="spacer" />
        <span className="ctr-kbd">
          <kbd>F2</kbd> ค้นหารถ · <kbd>F4</kbd> ใบเสร็จ · <kbd>Enter</kbd> ตกลง · <kbd>Ctrl</kbd>+<kbd>Enter</kbd> ยืนยันส่วนลด · <kbd>Esc</kbd> ล้าง
        </span>
        {user && (
          <>
            <span className="small">{user.displayName}</span>
            {can('dashboard.view', 'sessions.view') && (
              <Link className="btn btn-sm" to="/admin">
                Admin
              </Link>
            )}
            <Button size="sm" onClick={logout}>
              ออกจากระบบ
            </Button>
          </>
        )}
      </div>

      <div className="ctr-main">
        {/* ---------------------------------------------------- left: vehicle */}
        <div className="ctr-col">
          <Card title={<span data-el={T}>ค้นหารถ</span>}>
            <form
              className="col"
              onSubmit={(e) => {
                e.preventDefault();
                submitVehicle();
              }}
            >
              <div className="ctr-scan">
                <input className="input" ref={vehicleRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="สแกน QR บัตรจอด / Parking ID / ทะเบียน เช่น กข 1234" autoFocus />
                <Button type="submit" variant="primary">
                  ค้นหา
                </Button>
              </div>
              <div className="row">
                <span className="small muted">จังหวัด (เมื่อค้นหาด้วยทะเบียน)</span>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <ProvinceSelect value={province} onChange={setProvince} />
                </div>
                {cameraScanSupported() && (
                  <Button size="sm" onClick={() => setCamera(camera === 'vehicle' ? null : 'vehicle')}>
                    📷 {camera === 'vehicle' ? 'ปิดกล้อง' : 'สแกนด้วยกล้อง'}
                  </Button>
                )}
              </div>
            </form>
            {camera === 'vehicle' && (
              <div className="mt">
                <CameraScanner
                  onDetect={(c) => {
                    setCamera(null);
                    if (isReceiptCode(c)) addReceipt(c);
                    else lookup({ code: c });
                  }}
                />
              </div>
            )}
            {lookupErr && <div className="notice notice-danger mt">{lookupErr}</div>}
            {results.length > 1 && (
              <div className="ctr-results mt">
                {results.map((r) => (
                  <button key={r.id} type="button" className="ctr-result" onClick={() => selectItem(r)} style={sel?.id === r.id ? { borderColor: 'var(--color-primary)' } : undefined}>
                    <PlateBox plate={r.plateText} province={r.province} plateEl="info-counter/main/vehicle/plate" provinceEl="info-counter/main/vehicle/province" />
                    <span className="col">
                      <span className="mono">{r.parkingNo}</span>
                      <span className="small muted">เข้า {dateTime(r.entryAt)}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </Card>

          {sel && quote ? (
            <Card title={<span data-el={T}>ข้อมูลรถ</span>} actions={<Badge>{quote.paymentStatus}</Badge>}>
              <div className="ctr-vehicle">
                <PlateBox plate={sel.plateText} province={sel.province} plateEl="info-counter/main/vehicle/plate" provinceEl="info-counter/main/vehicle/province" />
                <div className="col">
                  <span className="small muted">ค่าจอดปัจจุบัน</span>
                  <span className="ctr-fee" data-el="info-counter/main/fee/value">
                    {money(quote.due)}
                  </span>
                </div>
              </div>
              <div className="kv mt">
                <span>Parking ID</span>
                <span className="mono">{sel.parkingNo}</span>
                <span>เวลาเข้า</span>
                <span>{dateTime(quote.entryAt)}</span>
                <span>ระยะเวลาจอด</span>
                <span>
                  {Math.floor(elapsed / 3600)} ชม. {Math.floor((elapsed % 3600) / 60)} นาที
                </span>
                <span>ค่าจอดปกติ</span>
                <span>{money(quote.gross)}</span>
                <span>ส่วนลดรวม</span>
                <span>{quote.discountTotal ? `− ${money(quote.discountTotal)}` : '-'}</span>
                <span>ชำระแล้ว</span>
                <span>{quote.paid ? money(quote.paid) : '-'}</span>
                {quote.exitDeadlineAt && (
                  <>
                    <span>ต้องออกภายใน</span>
                    <span>{time(quote.exitDeadlineAt)} น.</span>
                  </>
                )}
                {sel.flags.length > 0 && (
                  <>
                    <span>หมายเหตุ</span>
                    <span>
                      {sel.flags.map((f) => (
                        <Badge key={f} tone="warning">
                          {f}
                        </Badge>
                      ))}
                    </span>
                  </>
                )}
              </div>
              {quote.discounts.length > 0 && (
                <div className="mt">
                  <div className="small muted">ส่วนลดที่มีอยู่</div>
                  <ul className="small" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                    {quote.discounts.map((d) => (
                      <li key={d.id}>
                        {d.label} {d.amount ? money(d.amount) : ''} <Badge>{d.status}</Badge> <span className="muted">{dateTime(d.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="row mt">
                {user && can('payment.cash') && quote.due > 0 && (
                  <Button variant="success" onClick={() => setDialog('cash')}>
                    💵 รับเงินสด
                  </Button>
                )}
                {user && can('sessions.lost_ticket') && (
                  <Button variant="danger" onClick={() => setDialog('lost')}>
                    บัตรหาย / ออกบัตรใหม่
                  </Button>
                )}
              </div>
            </Card>
          ) : (
            <Card>
              <Empty>สแกน QR บัตรจอดรถ หรือค้นหาด้วย Parking ID / ทะเบียน</Empty>
            </Card>
          )}

          <StampCalculator />
        </div>

        {/* -------------------------------------------------- right: receipts */}
        <div className="ctr-col">
          <Card title={<span data-el={T}>ใบเสร็จร้านค้า</span>} actions={<span className="small muted">{allowMultiple ? 'ใช้ได้หลายใบ' : 'ใช้ได้ 1 ใบต่อการจอด'}</span>}>
            <form
              className="ctr-scan"
              onSubmit={(e) => {
                e.preventDefault();
                addReceipt(deThai(receiptInput));
                setReceiptInput('');
              }}
            >
              <input className="input" ref={receiptRef} value={receiptInput} onChange={(e) => setReceiptInput(e.target.value)} placeholder="สแกนบาร์โค้ด / QR ใบเสร็จ (PV1.…)" />
              <Button type="submit">ตรวจสอบ</Button>
              {cameraScanSupported() && (
                <Button onClick={() => setCamera(camera === 'receipt' ? null : 'receipt')} aria-label="camera">
                  📷
                </Button>
              )}
            </form>
            {camera === 'receipt' && (
              <div className="mt">
                <CameraScanner
                  onDetect={(c) => {
                    setCamera(null);
                    addReceipt(c);
                  }}
                />
              </div>
            )}
            {allowManual && (
              <form
                className="row mt"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!extRef.trim() || !(Number(extAmount) > 0)) return;
                  setExternal((x) => [...x.filter((y) => y.ref !== extRef.trim()), { ref: extRef.trim(), amount: Number(extAmount) }]);
                  setExtRef('');
                  setExtAmount(null);
                }}
              >
                <span className="small muted">ใบเสร็จภายนอก</span>
                <Input value={extRef} onChange={(e) => setExtRef(e.target.value)} placeholder="เลขที่ใบเสร็จ" style={{ maxWidth: 180 }} />
                <NumberInput value={extAmount} onChange={setExtAmount} placeholder="ยอดเงิน" min={0} step="any" style={{ maxWidth: 140 }} />
                <Button type="submit" size="sm">
                  เพิ่ม
                </Button>
              </form>
            )}
          </Card>

          {receipts.map((r) => (
            <ReceiptCard key={r.result.receipt?.receiptNo ?? r.code} r={r.result} onRemove={() => setReceipts((x) => x.filter((y) => y !== r))} />
          ))}
          {external.map((e) => (
            <div key={e.ref} className="ctr-receipt ok">
              <div className="row">
                <span data-el="info-counter/main/receipt/merchant">ใบเสร็จภายนอก {e.ref}</span>
                <span className="spacer" />
                <span data-el="info-counter/main/receipt/value">{money(e.amount)}</span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setExternal((x) => x.filter((y) => y !== e))}>
                  ✕
                </button>
              </div>
            </div>
          ))}

          {sel && (preview || previewErr) && (
            <Card title={<span data-el={T}>สรุปส่วนลดค่าจอด</span>}>
              {previewErr && <div className="notice notice-danger">{previewErr}</div>}
              {preview && (
                <>
                  <div className="ctr-preview">
                    <PvRow label="ค่าจอดปัจจุบัน" value={money(preview.session.due)} />
                    <PvRow label="ยอดซื้อ" value={money(preview.eligibleSpend)} />
                    <PvRow label="ได้รับส่วนลดค่าจอด" value={`− ${money(preview.after?.discount ?? 0)}`} neg />
                    <div className="pv-row total">
                      <span data-el="info-counter/main/preview/label">ค่าจอดคงเหลือ</span>
                      <span className="pv-value" data-el="info-counter/main/preview/total">
                        {money(preview.after?.due ?? preview.session.due)}
                      </span>
                    </div>
                  </div>
                  {preview.reward.applied.length > 0 ? (
                    <ul className="small mt" style={{ margin: 0, paddingLeft: 18 }}>
                      {preview.reward.applied.map((a) => (
                        <li key={`${a.ruleId}-${a.merchantId}`}>
                          <b>{a.ruleName}</b>: {rewardText(a.reward)}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="notice mt">ยอดซื้อยังไม่ถึงเงื่อนไขรับส่วนลด</div>
                  )}
                  {preview.blocking.length > 0 && <div className="notice notice-danger mt">{preview.blocking.map(blockingText).join(' · ')}</div>}
                  <div className="row mt">
                    <Check label="พิมพ์ใบ Validation" checked={printSlip} onChange={setPrintSlip} />
                    <span className="spacer" />
                    <Button onClick={clearAll}>ล้าง (Esc)</Button>
                    <Button variant="primary" size="lg" disabled={!canApply} loading={busy} onClick={apply}>
                      ✓ ยืนยันให้ส่วนลด
                    </Button>
                  </div>
                </>
              )}
            </Card>
          )}
          {!sel && (receipts.length > 0 || external.length > 0) && <div className="notice">เลือกรถก่อนเพื่อคำนวณส่วนลดค่าจอด</div>}
        </div>
      </div>

      {sel && quote && dialog === 'cash' && <CashDialog open quote={quote} onClose={() => setDialog(null)} onDone={refreshSelected} />}
      {sel && quote && dialog === 'lost' && <LostTicketDialog open quote={quote} onClose={() => setDialog(null)} onDone={refreshSelected} />}
    </div>
  );
}

function PvRow({ label, value, neg }: { label: string; value: string; neg?: boolean }) {
  return (
    <div className={`pv-row ${neg ? 'neg' : ''}`}>
      <span data-el="info-counter/main/preview/label">{label}</span>
      <span className="pv-value" data-el="info-counter/main/preview/value">
        {value}
      </span>
    </div>
  );
}
