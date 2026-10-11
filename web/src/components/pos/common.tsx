/** Small building blocks shared by POS, Merchant Portal and Admin → Merchants. */
import { useState, type ReactNode } from 'react';
import { Badge, Button, Empty } from '../ui';
import { dateTime, money, num } from '../../lib/format';
import { PAYMENT_LABEL, SALE_STATUS_LABEL, VALIDATION_STATUS_LABEL, type Sale } from './types';
import './pos.css';

export function CopyButton({ text, label = 'คัดลอก' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          const ta = document.createElement('textarea');
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
        }
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? '✓ คัดลอกแล้ว' : label}
    </Button>
  );
}

/** Credentials that are shown exactly once (server stores only hashes). */
export function SecretBox({ title, rows, note }: { title: ReactNode; rows: Array<{ label: string; value: string }>; note?: ReactNode }) {
  return (
    <div className="secret-box">
      <strong>{title}</strong>
      {rows.map((r) => (
        <div key={r.label} className="secret-row">
          <span className="small muted" style={{ minWidth: 130 }}>
            {r.label}
          </span>
          <code>{r.value}</code>
          <CopyButton text={r.value} />
        </div>
      ))}
      <div className="small" style={{ color: 'var(--color-warning)' }}>
        {note ?? '⚠ ข้อมูลนี้จะแสดงเพียงครั้งเดียว ระบบไม่เก็บรหัสแบบอ่านได้ — กรุณาคัดลอกและส่งให้ร้านค้าอย่างปลอดภัย'}
      </div>
    </div>
  );
}

export function TrendBars({ data }: { data: Array<{ date: string; net: number; count: number }> }) {
  const max = Math.max(1, ...data.map((d) => d.net));
  return (
    <div>
      <div className="trend">
        {data.map((d) => (
          <div key={d.date} className="bar" style={{ height: `${Math.max(2, (d.net / max) * 100)}%` }} title={`${d.date}: ${money(d.net)} (${d.count} บิล)`} />
        ))}
      </div>
      <div className="row small muted" style={{ justifyContent: 'space-between' }}>
        <span>{data[0]?.date}</span>
        <span>{data[data.length - 1]?.date}</span>
      </div>
    </div>
  );
}

export function SaleStatus({ s }: { s: Pick<Sale, 'status'> }) {
  return <Badge>{s.status}</Badge>;
}

export function ValidationStatus({ s }: { s: Pick<Sale, 'parking_validation_status' | 'plate_text' | 'parking_no'> }) {
  return (
    <span className="col" style={{ gap: 2 }}>
      <span>
        <Badge tone={s.parking_validation_status === 'USED' ? 'success' : s.parking_validation_status === 'NOT_USED' ? '' : 'danger'}>
          {VALIDATION_STATUS_LABEL[s.parking_validation_status] ?? s.parking_validation_status}
        </Badge>
      </span>
      {s.plate_text && (
        <span className="small muted">
          🚗 {s.plate_text} · {s.parking_no}
        </span>
      )}
    </span>
  );
}

export function SalesTable({ items, onOpen, el = 'merchant-portal/sales/table/receiptNo' }: { items: Sale[]; onOpen?: (s: Sale) => void; el?: string }) {
  if (!items.length) return <Empty>ไม่มีรายการขาย</Empty>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>เลขที่ใบเสร็จ</th>
            <th>วันที่/เวลา</th>
            <th>พนักงาน</th>
            <th className="right">ยอดสุทธิ</th>
            <th>ชำระโดย</th>
            <th>สถานะ</th>
            <th>สิทธิ์จอดรถ</th>
          </tr>
        </thead>
        <tbody>
          {items.map((s) => (
            <tr key={s.id} onClick={onOpen ? () => onOpen(s) : undefined} style={{ cursor: onOpen ? 'pointer' : undefined }}>
              <td className="mono" data-el={el}>
                {s.receipt_no}
                {s.external && <span className="badge" style={{ marginLeft: 6 }}>API</span>}
              </td>
              <td className="nowrap">{dateTime(s.issued_at)}</td>
              <td>{s.cashier_name ?? '-'}</td>
              <td className="right num">
                {money(s.total - s.refunded_amount)}
                {s.refunded_amount > 0 && <div className="small muted">คืน {money(s.refunded_amount)}</div>}
              </td>
              <td className="small">{s.payments.map((p) => PAYMENT_LABEL[p.method] ?? p.method).join(', ')}</td>
              <td>
                <Badge>{s.status}</Badge>
                <div className="small muted">{SALE_STATUS_LABEL[s.status]}</div>
              </td>
              <td>
                <ValidationStatus s={s} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Line items + payments of one sale (read-only). */
export function SaleBody({ sale, refunds, usage }: { sale: Sale; refunds?: Array<{ id: number; amount: number; reason: string; created_at: string; user_name?: string; approved_by_name?: string; method?: string }>; usage?: { parking_no: string; plate_text: string | null; created_at: string; status: string; discount_status?: string } | null }) {
  return (
    <div className="col">
      <div className="kv">
        <span>เลขที่</span>
        <span className="mono">{sale.receipt_no}</span>
        <span>วันที่</span>
        <span>{dateTime(sale.issued_at)}</span>
        <span>สถานะ</span>
        <span>
          <Badge>{sale.status}</Badge>
        </span>
        <span>พิมพ์ซ้ำ</span>
        <span>{sale.reprint_count} ครั้ง</span>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>สินค้า</th>
              <th className="right">จำนวน</th>
              <th className="right">ราคา</th>
              <th className="right">ส่วนลด</th>
              <th className="right">รวม</th>
            </tr>
          </thead>
          <tbody>
            {sale.items.map((l, i) => (
              <tr key={i}>
                <td>
                  {l.name}
                  {(l.variant || l.modifiers?.length > 0) && <div className="small muted">{[l.variant, ...(l.modifiers ?? []).map((m) => m.name)].filter(Boolean).join(' · ')}</div>}
                </td>
                <td className="right">{num(l.qty)}</td>
                <td className="right num">{money(l.unitPrice)}</td>
                <td className="right num">{l.discount ? `-${money(l.discount)}` : '-'}</td>
                <td className="right num">{money(l.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="kv">
        <span>รวม</span>
        <span className="num">{money(sale.subtotal)}</span>
        <span>ส่วนลด</span>
        <span className="num">-{money(sale.discount)}</span>
        <span>VAT</span>
        <span className="num">{money(sale.vat)}</span>
        <span>ยอดสุทธิ</span>
        <strong className="num">{money(sale.total)}</strong>
        <span>ชำระโดย</span>
        <span>{sale.payments.map((p) => `${PAYMENT_LABEL[p.method] ?? p.method} ${money(p.amount)}${p.ref ? ` (${p.ref})` : ''}`).join(' · ')}</span>
        {sale.refunded_amount > 0 && (
          <>
            <span>คืนเงินแล้ว</span>
            <span className="num">{money(sale.refunded_amount)}</span>
          </>
        )}
      </div>
      {refunds && refunds.length > 0 && (
        <div className="col">
          <strong>ประวัติคืนเงิน</strong>
          {refunds.map((r) => (
            <div key={r.id} className="small">
              {dateTime(r.created_at)} · {money(r.amount)} · {r.reason} · โดย {r.user_name ?? '-'} · อนุมัติ {r.approved_by_name ?? '-'}
            </div>
          ))}
        </div>
      )}
      <div className="col">
        <strong>สิทธิ์ส่วนลดจอดรถ</strong>
        <ValidationStatus s={sale} />
        {usage && (
          <div className="small">
            ใช้กับ {usage.parking_no} · ทะเบียน {usage.plate_text ?? '-'} · {dateTime(usage.created_at)} · ส่วนลด {usage.discount_status ?? '-'}
          </div>
        )}
      </div>
    </div>
  );
}
