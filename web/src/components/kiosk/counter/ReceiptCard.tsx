/** One verified (or rejected) receipt at the information counter. */
import type { ReactNode } from 'react';
import { Badge } from '../../ui';
import { date, dateTime, money, time } from '../../../lib/format';
import { RECEIPT_REASON } from '../receiptReasons';
import type { VerifiedReceipt } from '../types';

const L = 'info-counter/main/receipt/label';
const V = 'info-counter/main/receipt/value';

function KV({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div>
      <span className="k" data-el={L}>
        {k}
      </span>
      <span data-el={V}>{v}</span>
    </div>
  );
}

export function ReceiptCard({ r, onRemove }: { r: VerifiedReceipt; onRemove?: () => void }) {
  const rc = r.receipt;
  return (
    <div className={`ctr-receipt ${r.ok ? 'ok' : 'bad'}`}>
      <div className="row">
        <span data-el="info-counter/main/receipt/merchant">{rc ? `${rc.merchantName}${rc.branchCode ? ` · ${rc.branchCode}` : ''}` : '—'}</span>
        <span className="spacer" />
        {onRemove && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onRemove} aria-label="remove">
            ✕
          </button>
        )}
      </div>
      {rc && (
        <div className="grid-kv">
          <KV k="Receipt" v={<span className="mono">{rc.receiptNo}</span>} />
          <KV k="วันที่" v={date(rc.issuedAt)} />
          <KV k="เวลา" v={time(rc.issuedAt)} />
          <KV k="ยอดก่อนส่วนลด" v={money(rc.subtotal)} />
          <KV k="ส่วนลด" v={money(rc.discount)} />
          <KV k="ยอดชำระจริง" v={money(rc.total)} />
          <KV k="สถานะ" v={<Badge>{rc.status}</Badge>} />
          <KV k="Parking Validation" v={<Badge>{rc.validationStatus}</Badge>} />
        </div>
      )}
      <div className="verdict" data-el="info-counter/main/receipt/status">
        {r.ok ? '✓ VERIFIED RECEIPT' : `✕ ${RECEIPT_REASON[r.code]?.en ?? r.code}`}
      </div>
      {!r.ok && (
        <div className="small">
          {r.reasons.map((c) => RECEIPT_REASON[c]?.th ?? c).join(' · ')}
          {rc?.usedBy && (
            <div className="muted">
              ใช้แล้วกับ Parking ID {rc.usedBy.parkingNo}
              {rc.usedBy.plateText ? ` (ทะเบียน ${rc.usedBy.plateText})` : ''} เมื่อ {dateTime(rc.usedBy.at)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
