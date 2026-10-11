/** Every LPR / OCR candidate evaluated for a detection, raw text kept next to the parsed result. */
import { Badge, Button } from '../ui';
import { SecureImage } from './SecureImage';
import { confidenceTone, label, pct, SOURCE_TYPE } from './labels';

export interface Candidate {
  index: number;
  sourceType: string;
  valid: boolean;
  rejectReason?: string;
  ocrText?: string;
  text?: string;
  plate?: string;
  prefix: string;
  number: string;
  provinceCode: string | null;
  provinceName: string | null;
  provinceRaw: string;
  provinceSuggestions?: Array<{ code: string; th: string; similarity: number }>;
  provinceCorrected?: boolean;
  plateConfidence: number;
  provinceConfidence: number;
  plateText?: string;
  zone?: string;
  cropPath?: string;
}

export function CandidateTable({
  candidates,
  selectedIndex,
  onPick,
  pickLabel = 'เลือก',
}: {
  candidates: Candidate[];
  selectedIndex?: number | null;
  onPick?: (c: Candidate) => void;
  pickLabel?: string;
}) {
  if (!candidates.length) return <div className="small muted">ไม่มีผลอ่านจากกล้อง</div>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>#</th>
            <th>ภาพตัด</th>
            <th>แหล่งที่มา</th>
            <th>ข้อความ OCR ดิบ</th>
            <th>หมวด / เลข</th>
            <th>จังหวัด</th>
            <th>จังหวัด (ดิบ) / ที่ใกล้เคียง</th>
            <th>ความมั่นใจ ทะเบียน / จังหวัด</th>
            <th>โซน</th>
            {onPick && <th />}
          </tr>
        </thead>
        <tbody>
          {candidates.map((c, i) => (
            <tr key={c.index ?? i} style={selectedIndex === (c.index ?? i) ? { background: 'color-mix(in srgb, var(--color-success) 8%, transparent)' } : undefined}>
              <td>
                {(c.index ?? i) + 1}
                {selectedIndex === (c.index ?? i) && (
                  <div>
                    <Badge tone="success">ที่เลือก</Badge>
                  </div>
                )}
              </td>
              <td style={{ width: 130 }}>{c.cropPath ? <SecureImage path={c.cropPath} height={56} width={120} caption={undefined} /> : <span className="small muted">-</span>}</td>
              <td>
                <Badge tone={c.sourceType === 'REAL_PLATE' ? 'info' : c.sourceType === 'PAPER_SIGN' ? 'warning' : ''}>{label(SOURCE_TYPE, c.sourceType)}</Badge>
              </td>
              <td className="mono small" style={{ whiteSpace: 'pre-wrap', maxWidth: 200 }}>
                {c.ocrText || c.text || c.plate || '-'}
              </td>
              <td>
                {c.valid ? (
                  <b>
                    {c.prefix} {c.number}
                  </b>
                ) : (
                  <span>
                    <Badge tone="danger">ไม่ผ่าน</Badge> <span className="small muted">{c.rejectReason}</span>
                  </span>
                )}
              </td>
              <td>
                {c.provinceName ?? <span className="muted">ไม่ทราบ</span>}
                {c.provinceCorrected && (
                  <div>
                    <Badge tone="warning">แก้อัตโนมัติ</Badge>
                  </div>
                )}
              </td>
              <td className="small">
                <div className="mono">{c.provinceRaw || '-'}</div>
                {(c.provinceSuggestions ?? []).map((s) => (
                  <div key={s.code} className="muted">
                    {s.th} · {Math.round(s.similarity * 100)}%
                  </div>
                ))}
              </td>
              <td className="nowrap">
                <Badge tone={confidenceTone(c.plateConfidence)}>{pct(c.plateConfidence)}</Badge> / <Badge tone={confidenceTone(c.provinceConfidence)}>{pct(c.provinceConfidence)}</Badge>
              </td>
              <td className="small">{c.zone ?? '-'}</td>
              {onPick && (
                <td>
                  <Button size="sm" variant="primary" disabled={!c.valid} onClick={() => onPick(c)}>
                    {pickLabel}
                  </Button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
