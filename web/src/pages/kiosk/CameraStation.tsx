/**
 * Webcam LPR station: turns the computer's built-in / USB webcam into the
 * gate camera. Frames are read in the browser (Tesseract OCR, Thai), the plate
 * area (ROI) is cropped and enhanced, and candidates + images are posted to
 * /api/lpr/events with this CAMERA device's key. The server applies the same
 * policy (thresholds, province matching, review queue) as for LPR cameras.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { parsePlateText, provinceByCode, SOURCE_TYPES } from '@pp/shared';
import { storage } from '../../lib/api';
import { connectSocket } from '../../lib/socket';
import { Badge, Button, Card, Check, Field, Input, PlateBadge, ProvinceSelect, Select, errorText } from '../../components/ui';
import { CAMERA_KEY } from '../DeviceSetup';

interface Roi { x: number; y: number; w: number; h: number }
interface Read { text: string; confidence: number; plate: string | null; province: string; at: number }
type TessWorker = { recognize: (img: HTMLCanvasElement) => Promise<{ data: { text: string; confidence: number } }>; terminate: () => Promise<unknown> };

const DEFAULT_ROI: Roi = { x: 0.2, y: 0.3, w: 0.6, h: 0.4 };

function camFetch(key: string, path: string, body?: unknown) {
  return fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Device-Key': key },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => {
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.message ?? d.error ?? `HTTP ${r.status}`);
    return d;
  });
}

/** Crop the ROI, upscale, grayscale + contrast stretch + Otsu threshold for OCR. */
function preprocess(video: HTMLVideoElement, roi: Roi, binarize: boolean): HTMLCanvasElement {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const sx = roi.x * vw;
  const sy = roi.y * vh;
  const sw = roi.w * vw;
  const sh = roi.h * vh;
  const scale = Math.max(1, 360 / sh);
  const c = document.createElement('canvas');
  c.width = Math.round(sw * scale);
  c.height = Math.round(sh * scale);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, c.width, c.height);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const gray = new Uint8ClampedArray(c.width * c.height);
  let min = 255;
  let max = 0;
  for (let i = 0; i < gray.length; i++) {
    const g = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    gray[i] = g;
    if (g < min) min = g;
    if (g > max) max = g;
  }
  const range = Math.max(1, max - min);
  const hist = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = ((gray[i] - min) * 255) / range;
    hist[gray[i]]++;
  }
  let threshold = 128;
  if (binarize) {
    // Otsu
    let sum = 0;
    for (let t = 0; t < 256; t++) sum += t * hist[t];
    let sumB = 0;
    let wB = 0;
    let best = 0;
    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (!wB) continue;
      const wF = gray.length - wB;
      if (!wF) break;
      sumB += t * hist[t];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) ** 2;
      if (between > best) {
        best = between;
        threshold = t;
      }
    }
  }
  for (let i = 0; i < gray.length; i++) {
    const v = binarize ? (gray[i] > threshold ? 255 : 0) : gray[i];
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function snapshot(video: HTMLVideoElement, roi?: Roi, maxW = 960): string {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const src = roi ? { x: roi.x * vw, y: roi.y * vh, w: roi.w * vw, h: roi.h * vh } : { x: 0, y: 0, w: vw, h: vh };
  const s = Math.min(1, maxW / src.w);
  const c = document.createElement('canvas');
  c.width = Math.round(src.w * s);
  c.height = Math.round(src.h * s);
  c.getContext('2d')!.drawImage(video, src.x, src.y, src.w, src.h, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.75);
}

/** Mean absolute difference of a tiny grayscale thumbnail — cheap motion detector. */
function useMotion() {
  const prev = useRef<Uint8ClampedArray | null>(null);
  return useCallback((video: HTMLVideoElement) => {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 36;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(video, 0, 0, 64, 36);
    const d = ctx.getImageData(0, 0, 64, 36).data;
    const g = new Uint8ClampedArray(64 * 36);
    for (let i = 0; i < g.length; i++) g[i] = (d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 3;
    let diff = 0;
    if (prev.current) for (let i = 0; i < g.length; i++) diff += Math.abs(g[i] - prev.current[i]);
    prev.current = g;
    return prev.current ? diff / g.length : 0;
  }, []);
}

export default function CameraStation() {
  const [sp] = useSearchParams();
  const urlKey = sp.get('key');
  if (urlKey && urlKey !== storage.get(CAMERA_KEY)) storage.set(CAMERA_KEY, urlKey);
  const key = storage.get(CAMERA_KEY) ?? '';

  const videoRef = useRef<HTMLVideoElement>(null);
  const workerRef = useRef<TessWorker | null>(null);
  const busy = useRef(false);
  const motion = useMotion();
  const [boot, setBoot] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  const [camId, setCamId] = useState(storage.get('pp.camera.deviceId') ?? '');
  const [roi, setRoi] = useState<Roi>(() => {
    try {
      return JSON.parse(storage.get('pp.camera.roi') ?? '') as Roi;
    } catch {
      return DEFAULT_ROI;
    }
  });
  const [ocrState, setOcrState] = useState('ยังไม่โหลด');
  const [auto, setAuto] = useState(false);
  const [binarize, setBinarize] = useState(true);
  const [sourceType, setSourceType] = useState<string>('REAL_PLATE');
  const [minConf, setMinConf] = useState(45);
  const [read, setRead] = useState<Read | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [last, setLast] = useState<any>(null);
  const [gate, setGate] = useState<any>(null);
  const [manual, setManual] = useState<{ prefix: string; number: string; province: string | null }>({ prefix: '', number: '', province: '10' });
  const lastSent = useRef<{ plate: string; at: number } | null>(null);
  const prevRead = useRef<string | null>(null);

  useEffect(() => storage.set('pp.camera.roi', JSON.stringify(roi)), [roi]);

  useEffect(() => {
    if (!key) return;
    camFetch(key, '/api/kiosk/bootstrap')
      .then((b) => {
        if (b.device?.type !== 'CAMERA') throw new Error('Device Key นี้ไม่ใช่อุปกรณ์ประเภทกล้อง');
        if (!b.gate) throw new Error('กล้องนี้ยังไม่ได้ผูกกับทางเข้า/ออก — ตั้งค่าที่ Admin → อุปกรณ์');
        setBoot(b);
      })
      .catch((e) => setErr(e.message));
  }, [key]);

  useEffect(() => {
    if (!boot?.gate) return;
    const s = connectSocket({ deviceKey: key, token: null });
    s.on('gate:state', setGate);
    camFetch(key, `/api/gates/${boot.gate.id}/state`).then((r) => setGate(r.state)).catch(() => undefined);
    return () => void s.disconnect();
  }, [boot, key]);

  // Start the webcam.
  useEffect(() => {
    if (!boot) return;
    let stream: MediaStream | null = null;
    let alive = true;
    navigator.mediaDevices
      ?.getUserMedia({ video: camId ? { deviceId: { exact: camId }, width: { ideal: 1920 }, height: { ideal: 1080 } } : { width: { ideal: 1920 }, height: { ideal: 1080 }, facingMode: 'environment' }, audio: false })
      .then(async (s) => {
        if (!alive) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          await videoRef.current.play().catch(() => undefined);
        }
        setCams((await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput'));
      })
      .catch((e) => setErr(`เปิดกล้องไม่ได้: ${e.message} — อนุญาตการใช้กล้องในเบราว์เซอร์ (ต้องเปิดผ่าน https)`));
    if (!navigator.mediaDevices) setErr('เบราว์เซอร์นี้ไม่รองรับกล้อง หรือหน้าเว็บไม่ได้เปิดผ่าน https');
    return () => {
      alive = false;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [boot, camId]);

  const ensureWorker = async () => {
    if (workerRef.current) return workerRef.current;
    setOcrState('กำลังโหลดโมเดล OCR ภาษาไทย…');
    const { createWorker } = await import('tesseract.js');
    const w = (await createWorker('tha', 1, {
      logger: (m: { status: string; progress: number }) => m.status === 'loading language traineddata' && setOcrState(`กำลังโหลดภาษาไทย ${Math.round(m.progress * 100)}%`),
    })) as unknown as TessWorker & { setParameters: (p: Record<string, string>) => Promise<unknown> };
    await w.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
    workerRef.current = w;
    setOcrState('พร้อม');
    return w;
  };
  useEffect(() => () => void workerRef.current?.terminate(), []);

  const send = async (candidate: Record<string, unknown>, withCrop = true) => {
    const v = videoRef.current!;
    const r = await camFetch(key, '/api/lpr/events', {
      gateId: boot.gate.id,
      image: snapshot(v),
      candidates: [{ ...candidate, cropImage: withCrop ? snapshot(v, roi, 640) : undefined }],
    });
    setLast({ at: Date.now(), ...r });
    return r;
  };

  const scan = async (manualTrigger = false) => {
    const v = videoRef.current;
    if (!v || !v.videoWidth || busy.current) return;
    busy.current = true;
    try {
      const w = await ensureWorker();
      const canvas = preprocess(v, roi, binarize);
      setPreview(canvas.toDataURL('image/png'));
      const { data } = await w.recognize(canvas);
      const text = data.text.replace(/\n{2,}/g, '\n').trim();
      const parsed = parsePlateText(text);
      const plate = parsed ? `${parsed.prefix} ${parsed.number}` : null;
      const rd: Read = { text, confidence: Math.round(data.confidence), plate, province: parsed?.provinceRaw ?? '', at: Date.now() };
      setRead(rd);
      if (!plate) return;
      // In auto mode require the same plate twice in a row and skip repeats of the car just sent.
      const stable = manualTrigger || prevRead.current === plate;
      prevRead.current = plate;
      const repeat = lastSent.current && lastSent.current.plate === plate && Date.now() - lastSent.current.at < 60_000;
      if (manualTrigger || (stable && !repeat && rd.confidence >= minConf)) {
        lastSent.current = { plate, at: Date.now() };
        await send({ sourceType, text, plateConfidence: rd.confidence, provinceConfidence: rd.confidence });
      }
    } catch (e) {
      setErr(errorText(e));
    } finally {
      busy.current = false;
    }
  };

  // Auto mode: OCR when the scene changes, then keep reading while there is a vehicle.
  useEffect(() => {
    if (!auto) return;
    let quietFrames = 0;
    const t = setInterval(() => {
      const v = videoRef.current;
      if (!v?.videoWidth) return;
      const m = motion(v);
      if (m > 6) quietFrames = 0;
      else quietFrames++;
      // scan while moving and for a few seconds after the scene settles
      if (quietFrames < 6) scan(false);
    }, 1200);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, roi, binarize, minConf, sourceType]);

  const sendManual = async () => {
    try {
      await send({ sourceType: 'MANUAL_ENTRY', plate: `${manual.prefix}${manual.number}`, province: provinceByCode(manual.province)?.th ?? '', plateConfidence: 100, provinceConfidence: manual.province ? 100 : 0 }, false);
      setManual({ ...manual, prefix: '', number: '' });
    } catch (e) {
      setErr(errorText(e));
    }
  };

  if (!key) {
    return (
      <div className="page-forbidden">
        ยังไม่ได้ผูกกล้อง — สร้าง Device Key ของอุปกรณ์ประเภท “กล้อง LPR” ที่ Admin → อุปกรณ์ แล้วเปิดลิงก์ Setup บนเครื่องนี้ <Link to="/setup">ตั้งค่าอุปกรณ์</Link>
      </div>
    );
  }

  const dragRoi = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const x0 = (e.clientX - box.left) / box.width;
    const y0 = (e.clientY - box.top) / box.height;
    const move = (ev: PointerEvent) => {
      const x1 = Math.min(1, Math.max(0, (ev.clientX - box.left) / box.width));
      const y1 = Math.min(1, Math.max(0, (ev.clientY - box.top) / box.height));
      const r = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
      if (r.w > 0.05 && r.h > 0.05) setRoi(r);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div style={{ padding: 16, display: 'grid', gap: 16, gridTemplateColumns: 'minmax(0, 1fr) 380px', minHeight: '100vh' }}>
      <div className="col">
        <div className="row">
          <h2 style={{ margin: 0 }}>📷 กล้องอ่านป้ายทะเบียน</h2>
          {boot && <Badge tone="info">{boot.device.name} · {boot.gate.name} ({boot.gate.direction === 'ENTRY' ? 'ทางเข้า' : 'ทางออก'})</Badge>}
          <span className="spacer" />
          {cams.length > 1 && (
            <Select
              value={camId}
              onChange={(e) => {
                setCamId(e.target.value);
                storage.set('pp.camera.deviceId', e.target.value);
              }}
              options={[{ value: '', label: 'กล้องเริ่มต้น' }, ...cams.map((c, i) => ({ value: c.deviceId, label: c.label || `กล้อง ${i + 1}` }))]}
            />
          )}
        </div>
        {err && <div style={{ color: 'var(--color-danger)' }}>{err}</div>}
        <div style={{ position: 'relative', background: '#000', borderRadius: 12, overflow: 'hidden', touchAction: 'none' }} onPointerDown={dragRoi}>
          <video ref={videoRef} muted playsInline style={{ width: '100%', display: 'block' }} />
          <div
            style={{
              position: 'absolute',
              left: `${roi.x * 100}%`,
              top: `${roi.y * 100}%`,
              width: `${roi.w * 100}%`,
              height: `${roi.h * 100}%`,
              border: '3px solid #22c55e',
              boxShadow: '0 0 0 9999px rgba(0,0,0,.35)',
              borderRadius: 6,
              pointerEvents: 'none',
            }}
          >
            <span style={{ position: 'absolute', top: -26, left: 0, color: '#22c55e', fontWeight: 700, fontSize: 14 }}>พื้นที่ป้ายทะเบียน (ลากเพื่อปรับ)</span>
          </div>
        </div>
        <div className="row">
          <Button variant="primary" size="lg" onClick={() => scan(true)} disabled={!boot}>อ่านป้ายและส่ง</Button>
          <Check label="อ่านอัตโนมัติเมื่อมีรถ" checked={auto} onChange={setAuto} />
          <Check label="ปรับขาว-ดำ (ช่วยอ่าน)" checked={binarize} onChange={setBinarize} />
          <span className="small muted">OCR: {ocrState}</span>
        </div>
        <div className="row">
          <Field label="ประเภทแหล่งข้อมูล">
            <Select value={sourceType} onChange={(e) => setSourceType(e.target.value)} options={SOURCE_TYPES.filter((s) => s !== 'MANUAL_ENTRY').map((s) => ({ value: s, label: s }))} />
          </Field>
          <Field label="ส่งอัตโนมัติเมื่อความมั่นใจ ≥ (%)">
            <Input type="number" value={minConf} onChange={(e) => setMinConf(Number(e.target.value))} style={{ width: 100 }} />
          </Field>
          <Button onClick={() => setRoi(DEFAULT_ROI)}>รีเซ็ตกรอบ</Button>
        </div>
        <div className="small muted">
          ทิปส์: ให้ป้ายทะเบียน (หรือกระดาษที่เขียนทะเบียน + จังหวัด) อยู่ในกรอบสีเขียว เต็มกรอบและไม่เอียง แสงสว่างพอ — ผลที่ความมั่นใจต่ำจะถูกส่งให้ยืนยันที่ Kiosk หรือเข้าคิวตรวจสอบของเจ้าหน้าที่ตามที่ตั้งค่าไว้
        </div>
      </div>

      <div className="col">
        <Card title="ผลการอ่านล่าสุด (OCR)">
          {preview && <img src={preview} alt="" style={{ width: '100%', borderRadius: 6, border: '1px solid var(--color-border)' }} />}
          {read ? (
            <div className="col mt">
              {read.plate ? <PlateBadge plate={read.plate} province={read.province || null} size={22} /> : <Badge tone="warning">ไม่พบรูปแบบทะเบียน</Badge>}
              <div className="small">ความมั่นใจ {read.confidence}%</div>
              <pre className="mono small" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{read.text || '(ว่าง)'}</pre>
            </div>
          ) : (
            <div className="muted small">ยังไม่มีการอ่าน</div>
          )}
        </Card>
        <Card title="ผลจากระบบ">
          {last?.detection ? (
            <div className="col">
              <div className="row">
                <Badge>{last.detection.decision}</Badge>
                <PlateBadge plate={last.detection.plate.text} province={last.detection.plate.province} />
              </div>
              {last.detection.reasons?.length > 0 && <div className="small muted">{last.detection.reasons.join(', ')}</div>}
            </div>
          ) : (
            <div className="muted small">ยังไม่ได้ส่ง</div>
          )}
          {gate && (
            <div className="mt">
              สถานะทาง{boot?.gate.direction === 'ENTRY' ? 'เข้า' : 'ออก'}: <Badge tone="info">{gate.kind}</Badge>
              {gate.message && <div className="small">{gate.message}</div>}
            </div>
          )}
        </Card>
        <Card title="กรอกทะเบียนเอง (อ่านไม่ได้)">
          <div className="row">
            <Input style={{ width: 80 }} placeholder="กข" value={manual.prefix} onChange={(e) => setManual({ ...manual, prefix: e.target.value })} />
            <Input style={{ width: 90 }} placeholder="1234" value={manual.number} onChange={(e) => setManual({ ...manual, number: e.target.value })} />
          </div>
          <div className="mt">
            <ProvinceSelect value={manual.province} onChange={(p) => setManual({ ...manual, province: p })} />
          </div>
          <Button className="mt" block onClick={sendManual} disabled={!manual.prefix || !manual.number}>ส่งทะเบียนนี้</Button>
        </Card>
        <div className="small muted">
          เปิดหน้า Kiosk ทางเข้าได้ที่ <Link to="/kiosk/entry">/kiosk/entry</Link> (คนละแท็บ/หน้าจอได้)
        </div>
      </div>
    </div>
  );
}
