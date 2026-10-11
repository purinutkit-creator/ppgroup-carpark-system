/**
 * Frame capture + OCR for cameras without on-board LPR.
 *  - snapshotUrl (HTTP/ONVIF snapshot URI) via fetch, or
 *  - rtspUrl via ffmpeg (single JPEG frame).
 * OCR engines: Plate Recognizer (LPR, Thai region) and/or a generic HTTP OCR
 * (PaddleOCR / Tesseract service) for paper signs and windshield text.
 * Results are posted as RawCandidates; the server applies the policy.
 */
import { spawn } from 'node:child_process';
import { cfg } from '../config.ts';

export interface CameraConn {
  protocol?: string;
  rtspUrl?: string;
  snapshotUrl?: string;
  username?: string;
  password?: string;
}

export async function grabFrame(c: CameraConn): Promise<Buffer> {
  if (c.snapshotUrl) {
    const headers: Record<string, string> = {};
    if (c.username) headers.Authorization = 'Basic ' + Buffer.from(`${c.username}:${c.password ?? ''}`).toString('base64');
    const r = await fetch(c.snapshotUrl, { headers, signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`snapshot HTTP ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  }
  if (c.rtspUrl) {
    return new Promise((resolve, reject) => {
      const ff = spawn('ffmpeg', ['-rtsp_transport', 'tcp', '-i', c.rtspUrl!, '-frames:v', '1', '-q:v', '3', '-f', 'image2', 'pipe:1'], { stdio: ['ignore', 'pipe', 'ignore'] });
      const chunks: Buffer[] = [];
      const t = setTimeout(() => ff.kill('SIGKILL'), 8000);
      ff.stdout.on('data', (d) => chunks.push(d));
      ff.on('close', (code) => {
        clearTimeout(t);
        code === 0 && chunks.length ? resolve(Buffer.concat(chunks)) : reject(new Error(`ffmpeg exit ${code}`));
      });
    });
  }
  throw new Error('camera has no snapshotUrl or rtspUrl');
}

export async function recognise(frame: Buffer): Promise<any[]> {
  const out: any[] = [];
  if (cfg.ocr.engine === 'platerecognizer' && cfg.ocr.token) {
    const fd = new FormData();
    fd.append('upload', new Blob([new Uint8Array(frame)]), 'frame.jpg');
    fd.append('regions', 'th');
    const r = await fetch(cfg.ocr.url || 'https://api.platerecognizer.com/v1/plate-reader/', { method: 'POST', headers: { Authorization: `Token ${cfg.ocr.token}` }, body: fd });
    const j: any = await r.json();
    for (const p of j.results ?? []) out.push({ sourceType: 'REAL_PLATE', plate: p.plate, plateConfidence: (p.score ?? 0) * 100, provinceConfidence: (p.region?.score ?? 0) * 100 });
  }
  if (cfg.ocr.engine === 'http' && cfg.ocr.url) {
    const r = await fetch(cfg.ocr.url, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(frame) });
    const j: any = await r.json();
    for (const b of j.blocks ?? []) out.push({ sourceType: b.sourceType ?? 'GENERAL_OCR', text: b.text, plateConfidence: b.confidence, provinceConfidence: b.provinceConfidence ?? b.confidence, bbox: b.bbox });
  }
  return out;
}
