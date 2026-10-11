/**
 * Multi-source vehicle identification at a gate: stores every candidate
 * (REAL_PLATE / PAPER_SIGN / WINDSHIELD_TEXT / ...) with raw OCR text, crops
 * and confidences, then applies the admin policy to pick a result.
 */
import { identify, manualPlate, provinceByCode, type DetectionZone, type IdentificationResult, type RawCandidate } from '@pp/shared';
import { q, json, nowIso, type Row } from '../db/index.ts';
import { getSetting } from '../lib/settings.ts';
import { savePrivateImage } from '../lib/files.ts';
import { raiseAlert, resolveAlerts } from '../lib/alerts.ts';
import { emit } from '../lib/realtime.ts';
import { badRequest, notFound } from '../lib/http.ts';

export interface DetectionInput {
  gateId: number;
  cameraId?: number | null;
  capturedAt?: string;
  image?: string | null;          // base64 full frame
  candidates: Array<RawCandidate & { cropImage?: string | null }>;
  vehicleType?: string;
  edgeEventId?: string | null;
}

export function recordDetection(input: DetectionInput): { detection: Row; result: IdentificationResult } {
  if (input.edgeEventId) {
    const existing = q.get('SELECT * FROM detections WHERE edge_event_id=?', input.edgeEventId);
    if (existing) return { detection: existing, result: json(existing.original_json, null as any) };
  }
  const gate = q.get('SELECT * FROM gates WHERE id=?', input.gateId);
  if (!gate) throw notFound('GATE_NOT_FOUND');
  const camera = input.cameraId ? q.get('SELECT * FROM devices WHERE id=?', input.cameraId) : null;
  const zones = json<{ zones?: DetectionZone[] }>(camera?.settings_json, {}).zones ?? [];
  const policy = getSetting('lpr');
  const raw: RawCandidate[] = (input.candidates ?? []).slice(0, 10).map((c) => {
    const { cropImage, ...rest } = c;
    return { ...rest, cropPath: savePrivateImage(cropImage, 'lpr-crop') ?? undefined };
  });
  const result = identify(raw, policy, zones);
  const sel = result.selected;
  const imagePath = savePrivateImage(input.image, 'lpr');
  const vehicleType = input.vehicleType ?? sel?.vehicleType ?? 'CAR';
  const id = q.insert('detections', {
    site_id: gate.site_id,
    gate_id: gate.id,
    camera_id: input.cameraId ?? null,
    direction: gate.direction,
    captured_at: input.capturedAt ?? nowIso(),
    image_path: imagePath,
    candidates_json: JSON.stringify(result.candidates),
    selected_index: result.selectedIndex,
    decision: result.decision,
    reasons: JSON.stringify(result.reasons),
    conflict: result.conflict ? 1 : 0,
    plate_prefix: sel?.prefix ?? null,
    plate_number: sel?.number ?? null,
    province: sel?.provinceCode ?? null,
    plate_key: sel?.key ?? null,
    source_type: sel?.sourceType ?? null,
    plate_confidence: sel?.plateConfidence ?? null,
    province_confidence: sel?.provinceConfidence ?? null,
    vehicle_type: vehicleType,
    review_status: result.reviewRequired ? 'PENDING' : 'NONE',
    original_json: JSON.stringify({ decision: result.decision, reasons: result.reasons, selectedIndex: result.selectedIndex, selected: sel }),
    edge_event_id: input.edgeEventId ?? null,
  });
  const detection = q.get('SELECT * FROM detections WHERE id=?', id)!;
  if (result.reviewRequired) {
    raiseAlert({
      type: 'LPR_REVIEW',
      severity: result.decision === 'MANUAL_REVIEW' || result.decision === 'NO_READ' ? 'WARNING' : 'INFO',
      siteId: gate.site_id,
      refType: 'detection',
      refId: id,
      message: `ตรวจสอบผลอ่านป้าย ${gate.name}: ${sel?.fullText ?? 'อ่านไม่ได้'} (${result.reasons.join(', ')})`,
      dedupeKey: `LPR_REVIEW:${id}`,
    });
  }
  emit.staff('detection:new', detectionView(detection));
  return { detection, result };
}

export function detectionView(d: Row) {
  return {
    id: d.id,
    siteId: d.site_id,
    gateId: d.gate_id,
    cameraId: d.camera_id,
    direction: d.direction,
    capturedAt: d.captured_at,
    imagePath: d.image_path,
    candidates: json<any[]>(d.candidates_json, []),
    selectedIndex: d.selected_index,
    decision: d.decision,
    reasons: json<string[]>(d.reasons, []),
    conflict: !!d.conflict,
    plate: {
      prefix: d.plate_prefix,
      number: d.plate_number,
      provinceCode: d.province,
      province: provinceByCode(d.province)?.th ?? null,
      text: d.plate_prefix ? `${d.plate_prefix} ${d.plate_number}` : null,
      key: d.plate_key,
      sourceType: d.source_type,
      plateConfidence: d.plate_confidence,
      provinceConfidence: d.province_confidence,
    },
    vehicleType: d.vehicle_type,
    reviewStatus: d.review_status,
    original: json(d.original_json, null),
    corrected: json(d.corrected_json, null),
    correctedBy: d.corrected_by,
    correctedAt: d.corrected_at,
    sessionId: d.session_id,
  };
}

/** Staff correction: keeps the original result, stores the corrected one and who changed it. */
export function correctDetection(id: number, input: { prefix: string; number: string; province: string | null; sourceType?: string; candidateIndex?: number }, userId: number) {
  const d = q.get('SELECT * FROM detections WHERE id=?', id);
  if (!d) throw notFound('DETECTION_NOT_FOUND');
  let plate;
  if (input.candidateIndex != null) {
    const c = json<any[]>(d.candidates_json, [])[input.candidateIndex];
    if (!c?.valid) throw badRequest('INVALID_CANDIDATE');
    plate = manualPlate(c.prefix, c.number, input.province ?? c.provinceCode);
  } else {
    if (!input.prefix || !input.number) throw badRequest('VALIDATION', 'prefix and number required');
    plate = manualPlate(input.prefix, input.number, input.province);
  }
  const before = { prefix: d.plate_prefix, number: d.plate_number, province: d.province, key: d.plate_key, sourceType: d.source_type };
  const after = { prefix: plate.prefix, number: plate.number, province: plate.provinceCode, key: plate.key, sourceType: input.sourceType ?? (input.candidateIndex != null ? json<any[]>(d.candidates_json, [])[input.candidateIndex].sourceType : 'MANUAL_ENTRY') };
  q.update('detections', id, {
    plate_prefix: plate.prefix,
    plate_number: plate.number,
    province: plate.provinceCode,
    plate_key: plate.key,
    source_type: after.sourceType,
    corrected_json: JSON.stringify({ before, after }),
    corrected_by: userId,
    corrected_at: nowIso(),
    review_status: 'RESOLVED',
  });
  resolveAlerts(`LPR_REVIEW:${id}`);
  return { detection: q.get('SELECT * FROM detections WHERE id=?', id)!, before, after, plate };
}
