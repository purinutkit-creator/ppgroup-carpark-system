/**
 * Camera / LPR result normalisers. Devices push results to
 * POST /api/lpr/events/:format (device key auth). Each adapter converts a
 * vendor payload into RawCandidate[] for the multi-source identification
 * engine. Cameras without on-board LPR (plain IP / RTSP / ONVIF) are handled
 * by the edge agent, which grabs frames and calls an OCR engine, then posts
 * the "generic" format.
 */
import type { RawCandidate, SourceType } from '@pp/shared';

export interface NormalizedEvent {
  candidates: RawCandidate[];
  image?: string | null;
  crops?: Record<number, string>;
  capturedAt?: string;
  vehicleType?: string;
  eventId?: string;
}

type Adapter = (body: any) => NormalizedEvent;

/** Our own format (edge agent / integrators). */
const generic: Adapter = (b) => ({
  candidates: (b.candidates ?? []).map((c: any) => ({ ...c, sourceType: (c.sourceType ?? 'GENERAL_OCR') as SourceType })),
  image: b.image ?? null,
  capturedAt: b.capturedAt,
  vehicleType: b.vehicleType,
  eventId: b.eventId,
});

/** Plate Recognizer (Snapshot / Stream) webhook/result JSON. */
const platerecognizer: Adapter = (b) => {
  const data = b.data ?? b;
  const results = data.results ?? [];
  return {
    candidates: results.map((r: any) => ({
      sourceType: 'REAL_PLATE' as SourceType,
      plate: String(r.plate ?? ''),
      province: r.region?.code && r.region.code.startsWith('th-') ? r.region?.name ?? '' : '',
      plateConfidence: (r.score ?? 0) * 100,
      provinceConfidence: (r.region?.score ?? 0) * 100,
      vehicleType: r.vehicle?.type ? mapVehicle(r.vehicle.type) : undefined,
      bbox: r.box && data.image_width ? { x: r.box.xmin / data.image_width, y: r.box.ymin / data.image_height, w: (r.box.xmax - r.box.xmin) / data.image_width, h: (r.box.ymax - r.box.ymin) / data.image_height } : undefined,
    })),
    capturedAt: data.timestamp,
    eventId: b.hook?.id ? `${b.hook.id}:${data.timestamp}` : undefined,
  };
};

/** Generic OCR engines (PaddleOCR / Tesseract / cloud OCR) returning text blocks. */
const ocrText: Adapter = (b) => ({
  candidates: (b.blocks ?? b.texts ?? []).map((t: any) => ({
    sourceType: (t.sourceType ?? 'GENERAL_OCR') as SourceType,
    text: t.text,
    plateConfidence: t.confidence,
    provinceConfidence: t.provinceConfidence ?? t.confidence,
    bbox: t.bbox,
  })),
  image: b.image,
  capturedAt: b.capturedAt,
  eventId: b.eventId,
});

function mapVehicle(t: string) {
  const m: Record<string, string> = { Sedan: 'CAR', SUV: 'CAR', 'Pickup Truck': 'CAR', Van: 'VAN', Motorcycle: 'MOTORCYCLE', 'Big Truck': 'TRUCK', Bus: 'TRUCK' };
  return m[t] ?? 'CAR';
}

export const cameraAdapters: Record<string, Adapter> = { generic, platerecognizer, ocr: ocrText };
