/**
 * Fonts Library: Google fonts and uploaded fonts (with license confirmation),
 * preview before saving, delete when unused.
 */
import { useEffect, useMemo, useState } from 'react';
import { api, del, get, post } from '../../../lib/api';
import { Badge, Button, Card, Check, ConfirmDialog, Empty, Field, Input, Modal, Select, TextArea, errorText, useAsync, useToast } from '../../../components/ui';
import { FontWeightsEditor } from '../../../components/appearance/FontPicker';
import { ALL_WEIGHTS, PREVIEW_TEXT, WEIGHT_NAMES, cssFamily, ensureGoogleFont, ensureUploadedFont, invalidateLibrary, useFontSources, type LibraryFont } from '../../../components/appearance/fonts';
import { dateTime } from '../../../lib/format';
import { useAppearance } from './context';

export function FontsLibrary() {
  const { perms, reload } = useAppearance();
  const toast = useToast();
  const list = useAsync(() => get<{ items: LibraryFont[] }>('/api/appearance/fonts'), []);
  const [addGoogle, setAddGoogle] = useState(false);
  const [upload, setUpload] = useState(false);
  const [delFont, setDelFont] = useState<LibraryFont | null>(null);
  const refresh = async () => {
    invalidateLibrary();
    await Promise.all([list.reload(), reload()]);
  };
  useEffect(() => {
    for (const f of list.data?.items ?? []) {
      if (f.source === 'UPLOAD') ensureUploadedFont({ family: f.family, source: 'UPLOAD', weights: f.weights, files: f.files });
      else if (f.source === 'GOOGLE') ensureGoogleFont(f.family, f.weights.includes(400) ? [400] : f.weights.slice(0, 1));
    }
  }, [list.data]);

  return (
    <div className="col" style={{ gap: 16 }}>
      <Card
        title="Fonts Library"
        actions={
          <>
            {perms.google && (
              <Button variant="primary" onClick={() => setAddGoogle(true)}>
                + Add Google Font
              </Button>
            )}
            {perms.upload && <Button onClick={() => setUpload(true)}>⬆ Upload Custom Font</Button>}
          </>
        }
      >
        {list.error && <div className="error">{list.error}</div>}
        {list.data && !list.data.items.length && <Empty />}
        {list.data && list.data.items.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Font</th>
                  <th>Preview</th>
                  <th>Source</th>
                  <th>Weights</th>
                  <th>License</th>
                  <th>สถานะ</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((f) => (
                  <tr key={f.family}>
                    <td>
                      <b>{f.family}</b>
                      {f.createdBy && (
                        <div className="small muted">
                          {f.createdBy} · {f.createdAt ? dateTime(f.createdAt) : ''}
                        </div>
                      )}
                    </td>
                    <td style={{ fontFamily: `${cssFamily(f.family)}, sans-serif`, fontSize: 17, maxWidth: 360, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{PREVIEW_TEXT}</td>
                    <td>
                      <Badge tone={f.source === 'UPLOAD' ? 'warning' : 'info'}>{f.source}</Badge>
                    </td>
                    <td className="small">{f.weights.join(', ')}</td>
                    <td className="small">
                      {f.licenseName ?? '-'}
                      {f.licenseNote && <div className="muted">{f.licenseNote}</div>}
                      {f.licenseConfirmedBy && (
                        <div className="muted">
                          ✓ ยืนยันโดย {f.licenseConfirmedBy} {f.licenseConfirmedAt ? dateTime(f.licenseConfirmedAt) : ''}
                        </div>
                      )}
                    </td>
                    <td>{f.inUse ? <Badge tone="success">ใช้งานอยู่</Badge> : <Badge>ไม่ได้ใช้</Badge>}</td>
                    <td className="right">
                      {((f.source === 'UPLOAD' && perms.upload) || (f.source !== 'UPLOAD' && perms.google)) && (
                        <Button size="sm" variant="ghost" disabled={f.inUse} title={f.inUse ? 'ฟอนต์นี้ถูกใช้งานอยู่ ต้องเปลี่ยนฟอนต์ก่อนลบ' : undefined} onClick={() => setDelFont(f)}>
                          ลบ
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <AddGoogleFont open={addGoogle} onClose={() => setAddGoogle(false)} onDone={refresh} />
      <UploadFont open={upload} onClose={() => setUpload(false)} onDone={refresh} />
      <ConfirmDialog
        open={!!delFont}
        danger
        title={`ลบฟอนต์ “${delFont?.family}”?`}
        message="ฟอนต์จะถูกนำออกจาก Font Library และ Design Configuration (สร้าง Version ใหม่)"
        confirmText="ลบฟอนต์"
        onClose={() => setDelFont(null)}
        onConfirm={async () => {
          try {
            await del(`/api/appearance/fonts/${delFont!.id ?? encodeURIComponent(delFont!.family)}`);
            toast('ลบฟอนต์แล้ว', 'success');
            await refresh();
          } catch (e) {
            toast(errorText(e), 'error');
          }
        }}
      />
    </div>
  );
}

function AddGoogleFont({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => Promise<void> }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [subset, setSubset] = useState('thai');
  const [family, setFamily] = useState<string | null>(null);
  const [weights, setWeights] = useState<number[]>([400, 700]);
  const [busy, setBusy] = useState(false);
  const { google, googleSource } = useFontSources(open ? q : '', subset);
  const sel = google.find((g) => g.family === family);
  useEffect(() => {
    if (sel) ensureGoogleFont(sel.family, sel.weights);
  }, [sel]);
  useEffect(() => {
    google.slice(0, 30).forEach((g) => ensureGoogleFont(g.family, g.weights.includes(400) ? [400] : g.weights.slice(0, 1)));
  }, [google]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Add Google Font"
      footer={
        <>
          <Button onClick={onClose}>ยกเลิก</Button>
          <Button
            variant="primary"
            disabled={!sel}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await post('/api/appearance/fonts/google', { family: sel!.family, weights });
                toast(`เพิ่ม ${sel!.family} แล้ว`, 'success');
                await onDone();
                onClose();
              } catch (e) {
                toast(errorText(e), 'error');
              } finally {
                setBusy(false);
              }
            }}
          >
            เพิ่มลง Font Library
          </Button>
        </>
      }
    >
      <div className="grid grid-2">
        <div className="col">
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <Input placeholder="ค้นหา Google Fonts…" value={q} onChange={(e) => setQ(e.target.value)} />
            <Select
              style={{ width: 130 }}
              value={subset}
              onChange={(e) => setSubset(e.target.value)}
              options={[
                { value: '', label: 'ทุกภาษา' },
                { value: 'thai', label: 'Thai' },
                { value: 'latin', label: 'Latin' },
                { value: 'chinese-simplified', label: 'Chinese' },
              ]}
            />
          </div>
          {googleSource === 'builtin' && <div className="small muted">แสดงรายการฟอนต์แนะนำ (ตั้งค่า GOOGLE_FONTS_API_KEY บนเซิร์ฟเวอร์เพื่อค้นหาทั้งหมด)</div>}
          <div className="ap-fp-list" style={{ maxHeight: 380 }}>
            {google.map((g) => (
              <div
                key={g.family}
                className={`ap-fp-item ${g.family === family ? 'active' : ''}`}
                onClick={() => {
                  setFamily(g.family);
                  const def = g.weights.filter((w) => [400, 500, 600, 700].includes(w));
                  setWeights(def.length ? def : g.weights.slice(0, 1));
                }}
              >
                <span style={{ fontFamily: `${cssFamily(g.family)}, sans-serif` }}>{g.family}</span>
                <span className="small muted">{g.category}</span>
              </div>
            ))}
            {!google.length && <Empty>ไม่พบฟอนต์</Empty>}
          </div>
        </div>
        <div className="col">
          {sel ? (
            <>
              <h3 style={{ fontFamily: `${cssFamily(sel.family)}, sans-serif`, margin: 0 }}>{sel.family}</h3>
              <div className="small muted">
                {sel.category} · {sel.subsets.join(', ')}
              </div>
              <Field label="Weights ที่ต้องการโหลด">
                <FontWeightsEditor available={sel.weights} value={weights} onChange={setWeights} />
              </Field>
              <div className="col" style={{ gap: 4 }}>
                {weights.map((w) => (
                  <div key={w} style={{ fontFamily: `${cssFamily(sel.family)}, sans-serif`, fontWeight: w, fontSize: 18 }}>
                    <span className="small muted" style={{ fontFamily: 'inherit', fontWeight: 400, display: 'inline-block', width: 110 }}>
                      {w} {WEIGHT_NAMES[w]}
                    </span>
                    {PREVIEW_TEXT}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <Empty>เลือกฟอนต์เพื่อดูตัวอย่าง</Empty>
          )}
        </div>
      </div>
    </Modal>
  );
}

interface UploadRow {
  file: File;
  weight: number;
  style: 'normal' | 'italic';
}

const UPLOAD_WEIGHTS = [
  { value: 400, label: 'Regular (400)' },
  { value: 500, label: 'Medium (500)' },
  { value: 600, label: 'SemiBold (600)' },
  { value: 700, label: 'Bold (700)' },
  ...ALL_WEIGHTS.filter((w) => ![400, 500, 600, 700].includes(w)).map((w) => ({ value: w, label: `${WEIGHT_NAMES[w]} (${w})` })),
];

function guessWeight(name: string) {
  const n = name.toLowerCase();
  if (/semi.?bold|demi/.test(n)) return 600;
  if (/extra.?bold|ultra.?bold/.test(n)) return 800;
  if (/bold/.test(n)) return 700;
  if (/medium/.test(n)) return 500;
  if (/extra.?light|ultra.?light/.test(n)) return 200;
  if (/light/.test(n)) return 300;
  if (/thin|hairline/.test(n)) return 100;
  if (/black|heavy/.test(n)) return 900;
  return 400;
}

function UploadFont({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => Promise<void> }) {
  const toast = useToast();
  const [family, setFamily] = useState('');
  const [rows, setRows] = useState<UploadRow[]>([]);
  const [licenseName, setLicenseName] = useState('');
  const [licenseNote, setLicenseNote] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [previewOk, setPreviewOk] = useState<Record<string, boolean>>({});
  const previewFamily = useMemo(() => `ap-upload-preview-${Math.random().toString(36).slice(2, 8)}`, [open]);

  useEffect(() => {
    if (!open) {
      setFamily('');
      setRows([]);
      setLicenseName('');
      setLicenseNote('');
      setConfirmed(false);
      setPreviewOk({});
    }
  }, [open]);

  // Load each chosen file with the FontFace API so it can be previewed before upload.
  useEffect(() => {
    let alive = true;
    const faces: FontFace[] = [];
    rows.forEach(async (r) => {
      const key = `${r.file.name}|${r.weight}|${r.style}`;
      try {
        const face = new FontFace(previewFamily, await r.file.arrayBuffer(), { weight: String(r.weight), style: r.style });
        await face.load();
        if (!alive) return;
        document.fonts.add(face);
        faces.push(face);
        setPreviewOk((p) => ({ ...p, [key]: true }));
      } catch {
        if (alive) setPreviewOk((p) => ({ ...p, [key]: false }));
      }
    });
    return () => {
      alive = false;
      faces.forEach((f) => document.fonts.delete(f));
    };
  }, [rows, previewFamily]);

  const dupe = rows.some((r, i) => rows.findIndex((x) => x.weight === r.weight && x.style === r.style) !== i);
  const invalid = rows.some((r) => previewOk[`${r.file.name}|${r.weight}|${r.style}`] === false);
  const ready = family.trim() && rows.length && licenseName.trim() && confirmed && !dupe && !invalid;

  const submit = async () => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('family', family.trim());
      fd.append('licenseName', licenseName.trim());
      fd.append('licenseNote', licenseNote.trim());
      fd.append('licenseConfirmed', 'true');
      fd.append('meta', JSON.stringify(rows.map((r) => ({ weight: r.weight, style: r.style }))));
      rows.forEach((r) => fd.append('files', r.file));
      await api('/api/appearance/fonts/upload', { method: 'POST', body: fd });
      toast(`อัปโหลดฟอนต์ ${family} แล้ว`, 'success');
      await onDone();
      onClose();
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Upload Custom Font"
      footer={
        <>
          <Button onClick={onClose}>ยกเลิก</Button>
          <Button variant="primary" disabled={!ready} loading={busy} onClick={submit}>
            อัปโหลดและเพิ่มลง Library
          </Button>
        </>
      }
    >
      <div className="col">
        <Field label="ชื่อฟอนต์ (Font family name)">
          <Input value={family} onChange={(e) => setFamily(e.target.value)} placeholder="เช่น PP Brand Sans" maxLength={80} />
        </Field>
        <Field label="ไฟล์ฟอนต์ (.ttf .otf .woff .woff2) — 1 ไฟล์ต่อ 1 น้ำหนัก/สไตล์">
          <label className="btn btn-sm" style={{ alignSelf: 'flex-start' }}>
            + เลือกไฟล์
            <input
              type="file"
              hidden
              multiple
              accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2"
              onChange={(e) => {
                const files = [...(e.target.files ?? [])];
                setRows((cur) => [...cur, ...files.map((file) => ({ file, weight: guessWeight(file.name), style: (/italic|oblique/i.test(file.name) ? 'italic' : 'normal') as UploadRow['style'] }))]);
                if (!family && files[0]) setFamily(files[0].name.replace(/\.(ttf|otf|woff2?)$/i, '').replace(/[-_ ]?(regular|bold|medium|semibold|light|thin|black|italic)+$/i, '').replace(/[-_]/g, ' ').trim());
                e.target.value = '';
              }}
            />
          </label>
        </Field>
        {rows.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>ไฟล์</th>
                  <th>Weight</th>
                  <th>Style</th>
                  <th>Preview</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const ok = previewOk[`${r.file.name}|${r.weight}|${r.style}`];
                  return (
                    <tr key={i}>
                      <td className="small">
                        {r.file.name}
                        <div className="muted">{(r.file.size / 1024).toFixed(0)} KB</div>
                      </td>
                      <td>
                        <Select value={r.weight} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, weight: Number(e.target.value) } : x)))} options={UPLOAD_WEIGHTS} />
                      </td>
                      <td>
                        <Select value={r.style} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, style: e.target.value as UploadRow['style'] } : x)))} options={['normal', 'italic']} />
                      </td>
                      <td style={{ fontFamily: `"${previewFamily}", sans-serif`, fontWeight: r.weight, fontStyle: r.style, fontSize: 17, maxWidth: 300, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                        {ok === false ? <span className="error" style={{ color: 'var(--color-danger)', fontFamily: 'initial' }}>ไฟล์ฟอนต์ไม่ถูกต้อง</span> : PREVIEW_TEXT}
                      </td>
                      <td>
                        <Button size="sm" variant="ghost" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                          ✕
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {dupe && <div className="small" style={{ color: 'var(--color-danger)' }}>มีไฟล์ที่ใช้ Weight/Style ซ้ำกัน</div>}
        <div className="grid grid-2">
          <Field label="ชื่อ License">
            <Input value={licenseName} onChange={(e) => setLicenseName(e.target.value)} placeholder="เช่น Commercial Desktop + Web License" />
          </Field>
          <Field label="หมายเหตุ License">
            <TextArea value={licenseNote} onChange={(e) => setLicenseNote(e.target.value)} placeholder="เลขที่สัญญา / ผู้จำหน่าย / ขอบเขตการใช้งาน" style={{ minHeight: 38 }} />
          </Field>
        </div>
        <Check label={<b>I confirm we hold a license for this use (ยืนยันว่าองค์กรมีสิทธิ์ใช้ฟอนต์นี้บนเว็บ ตู้ Kiosk และงานพิมพ์)</b>} checked={confirmed} onChange={setConfirmed} />
        <div className="small muted">การยืนยันจะถูกบันทึกพร้อมชื่อผู้ยืนยันและเวลาใน Font Library และ Audit Log</div>
      </div>
    </Modal>
  );
}
