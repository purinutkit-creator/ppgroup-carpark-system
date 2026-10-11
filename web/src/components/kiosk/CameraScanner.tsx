/**
 * Camera QR / barcode scanning with the browser's BarcodeDetector API
 * (Chrome/Edge on Android, ChromeOS, Windows kiosks). Hidden when unsupported.
 */
import { useEffect, useRef, useState } from 'react';

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike;

const Detector = (globalThis as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;

export const cameraScanSupported = () => !!Detector && !!navigator.mediaDevices?.getUserMedia;

export function CameraScanner({ onDetect, className, facing = 'environment' }: { onDetect: (code: string) => void; className?: string; facing?: 'environment' | 'user' }) {
  const video = useRef<HTMLVideoElement>(null);
  const cb = useRef(onDetect);
  cb.current = onDetect;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cameraScanSupported()) return;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let alive = true;
    let lastCode = '';
    let lastAt = 0;
    const detector = new Detector!({ formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'data_matrix'] });
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 } }, audio: false });
        if (!alive || !video.current) return;
        video.current.srcObject = stream;
        await video.current.play().catch(() => {});
        const tick = async () => {
          if (!alive || !video.current) return;
          try {
            if (video.current.readyState >= 2) {
              const found = await detector.detect(video.current);
              const code = found[0]?.rawValue?.trim();
              // the same code stays in view for a while — report it once per 4 s
              if (code && (code !== lastCode || Date.now() - lastAt > 4000)) {
                lastCode = code;
                lastAt = Date.now();
                cb.current(code);
              }
            }
          } catch {
            /* frame not ready */
          }
          timer = setTimeout(tick, 250);
        };
        tick();
      } catch (e) {
        setError((e as Error).message || 'camera error');
      }
    })();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [facing]);

  if (!cameraScanSupported()) return null;
  return (
    <div className={`cam-scan ${className ?? ''}`}>
      <video ref={video} muted playsInline />
      <div className="cam-scan-frame" />
      {error && <div className="cam-scan-error">{error}</div>}
    </div>
  );
}
