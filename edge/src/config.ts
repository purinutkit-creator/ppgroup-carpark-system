import fs from 'node:fs';
import path from 'node:path';

/** Edge agent configuration — env vars, optionally overridden by edge.config.json. */
const file = process.env.EDGE_CONFIG ?? path.resolve('edge.config.json');
const json = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};

export const cfg = {
  serverUrl: (process.env.SERVER_URL ?? json.serverUrl ?? 'http://localhost:8080').replace(/\/$/, ''),
  deviceKey: process.env.DEVICE_KEY ?? json.deviceKey ?? '',
  queueFile: process.env.QUEUE_FILE ?? json.queueFile ?? path.resolve('queue', 'edge-queue.db'),
  bridgePort: Number(process.env.BRIDGE_PORT ?? json.bridgePort ?? 9110),
  /** OCR engine: 'platerecognizer' | 'http' (generic text OCR returning {blocks:[{text,confidence,bbox}]}) | 'none' */
  ocr: {
    engine: process.env.OCR_ENGINE ?? json.ocr?.engine ?? 'none',
    url: process.env.OCR_URL ?? json.ocr?.url ?? '',
    token: process.env.OCR_TOKEN ?? json.ocr?.token ?? '',
  },
  /** Seconds between camera polls when no external trigger (loop detector) is wired. */
  pollSeconds: Number(process.env.POLL_SECONDS ?? json.pollSeconds ?? 0),
  cacheRefreshSeconds: Number(json.cacheRefreshSeconds ?? 60),
};

if (!cfg.deviceKey) {
  console.error('DEVICE_KEY is required (create an EDGE device in Admin → อุปกรณ์ and generate a key).');
  process.exit(1);
}
