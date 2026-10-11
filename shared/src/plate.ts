/**
 * Multi-source vehicle identification for Thai plates.
 *
 * Input: raw candidates from LPR (plate detector) and general OCR (text
 * detector) running on the same camera frame. Output: every candidate parsed
 * into prefix / number / province with confidence, plus a deterministic
 * selection driven by admin policy (source priority + thresholds).
 * Nothing is ever silently overwritten: raw OCR text and raw province text are
 * always kept next to any corrected value.
 */
import { provinceByCode, provinceByName, suggestProvinces, type ProvinceSuggestion, UNKNOWN_PROVINCE } from './provinces.ts';

export const SOURCE_TYPES = [
  'REAL_PLATE',
  'TEMPORARY_PLATE',
  'PAPER_SIGN',
  'WINDSHIELD_TEXT',
  'GENERAL_OCR',
  'MANUAL_ENTRY',
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export type Decision = 'AUTO_CONFIRM' | 'KIOSK_CONFIRM' | 'MANUAL_REVIEW' | 'NO_READ';

export interface BBox { x: number; y: number; w: number; h: number } // normalized 0..1

export interface RawCandidate {
  sourceType: SourceType;
  /** Raw OCR text (may span several lines, e.g. "กข 1234\nกรุงเทพมหานคร"). */
  text?: string;
  /** Plate already segmented by an LPR engine, e.g. "1กข1234". */
  plate?: string;
  /** Province text from an LPR engine. */
  province?: string;
  plateConfidence?: number;    // 0..100
  provinceConfidence?: number; // 0..100
  typeConfidence?: number;     // 0..100 (confidence of sourceType classification)
  bbox?: BBox;
  /** Stored crop image path (server fills this after saving uploaded crops). */
  cropPath?: string;
  vehicleType?: string;
}

export interface EvaluatedCandidate extends RawCandidate {
  index: number;
  valid: boolean;
  rejectReason?: string;
  ocrText: string;
  prefix: string;
  number: string;
  provinceCode: string | null;
  provinceName: string | null;
  provinceRaw: string;
  provinceSuggestions: ProvinceSuggestion[];
  provinceCorrected: boolean;
  plateConfidence: number;
  provinceConfidence: number;
  plateText: string; // "1กข 1234"
  fullText: string;  // "1กข 1234 กรุงเทพมหานคร"
  key: string;       // matching key: prefix|number|provinceCode
  zone?: string;
}

export interface DetectionZone {
  name: string;
  rect: BBox;
  /** Source type assigned to generic OCR text found inside this zone. */
  expect: SourceType;
}

export interface LprPolicy {
  autoConfirmMin: number;
  kioskConfirmMin: number;
  priority: SourceType[];
  provinceAutoCorrectMinSimilarity: number; // 0..1
  provinceAutoCorrectMinConfidence: number; // 0..100
  requireProvince: boolean;
  conflictPolicy: 'PRIORITY' | 'REVIEW';
}

export const DEFAULT_LPR_POLICY: LprPolicy = {
  autoConfirmMin: 90,
  kioskConfirmMin: 70,
  priority: ['REAL_PLATE', 'TEMPORARY_PLATE', 'PAPER_SIGN', 'WINDSHIELD_TEXT', 'GENERAL_OCR'],
  provinceAutoCorrectMinSimilarity: 0.75,
  provinceAutoCorrectMinConfidence: 60,
  requireProvince: false,
  conflictPolicy: 'PRIORITY',
};

export interface IdentificationResult {
  candidates: EvaluatedCandidate[];
  selectedIndex: number | null;
  selected: EvaluatedCandidate | null;
  decision: Decision;
  conflict: boolean;
  reviewRequired: boolean;
  reasons: string[];
}

const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';
const LATIN_TO_DIGIT: Record<string, string> = {
  O: '0', o: '0', Q: '0', D: '0', I: '1', l: '1', i: '1', '|': '1', Z: '2', z: '2', S: '5', s: '5', B: '8', G: '6', T: '7',
};

export function normalizeOcr(input: string): string {
  let s = input.normalize('NFC');
  s = s.replace(/[๐-๙]/g, (d) => String(THAI_DIGITS.indexOf(d)));
  // Thai plates contain no Latin letters: map common OCR digit confusions, drop the rest.
  s = s.replace(/[A-Za-z|]/g, (c) => LATIN_TO_DIGIT[c] ?? ' ');
  s = s.replace(/[^฀-๿0-9\s-]/g, ' ');
  return s.replace(/[ \t]+/g, ' ').trim();
}

// Optional leading digit + 1–3 Thai consonants, then 1–4 digits.
const PLATE_RE = /(?<![ก-๎0-9])([0-9]?\s?[ก-ฮ]{1,3})\s*-?\s*([0-9]{1,4})(?![0-9])/u;

export interface ParsedText { prefix: string; number: string; provinceRaw: string }

/** Parse free text that may contain a Thai plate and a province name. */
export function parsePlateText(raw: string): ParsedText | null {
  const text = normalizeOcr(raw);
  const flat = text.replace(/\n+/g, ' ');
  const m = PLATE_RE.exec(flat);
  if (!m) return null;
  const prefix = m[1].replace(/\s/g, '');
  const number = String(parseInt(m[2], 10));
  const rest = (flat.slice(0, m.index) + ' ' + flat.slice(m.index + m[0].length))
    .replace(/[0-9-]/g, ' ')
    .replace(/\s+/g, '')
    .trim();
  return { prefix, number, provinceRaw: rest };
}

export function formatPlate(prefix: string, number: string): string {
  return `${prefix} ${number}`.trim();
}

/**
 * Matching key for a vehicle. Prefix + number + province together identify a
 * plate — "กข 1234 กรุงเทพมหานคร" and "กข 1234 ชลบุรี" are different vehicles.
 */
export function plateKey(prefix: string, number: string, provinceCode: string | null | undefined): string {
  return `${prefix.replace(/\s/g, '')}|${String(number).replace(/^0+(?=\d)/, '')}|${provinceCode || UNKNOWN_PROVINCE}`;
}

/** Key without province, used only to find *candidates* when province is unknown. */
export function plateKeyLoose(prefix: string, number: string): string {
  return `${prefix.replace(/\s/g, '')}|${String(number).replace(/^0+(?=\d)/, '')}|`;
}

function resolveProvince(raw: string, rawConfidence: number, policy: LprPolicy) {
  const suggestions = suggestProvinces(raw, 3);
  const top = suggestions[0];
  if (!raw || !top) {
    return { code: null, name: null, confidence: 0, corrected: false, suggestions };
  }
  if (top.similarity === 1) {
    return { code: top.code, name: top.th, confidence: rawConfidence, corrected: false, suggestions };
  }
  const margin = top.similarity - (suggestions[1]?.similarity ?? 0);
  const confidence = Math.round(rawConfidence * top.similarity);
  if (
    top.similarity >= policy.provinceAutoCorrectMinSimilarity &&
    rawConfidence >= policy.provinceAutoCorrectMinConfidence &&
    margin >= 0.1
  ) {
    return { code: top.code, name: top.th, confidence, corrected: true, suggestions };
  }
  return { code: null, name: null, confidence, corrected: false, suggestions };
}

function inRect(b: BBox, r: BBox): boolean {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  return cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h;
}

export function evaluateCandidate(
  c: RawCandidate,
  index: number,
  policy: LprPolicy = DEFAULT_LPR_POLICY,
  zones: DetectionZone[] = [],
): EvaluatedCandidate {
  let sourceType = c.sourceType;
  let zone: string | undefined;
  if (c.bbox) {
    const z = zones.find((zz) => inRect(c.bbox!, zz.rect));
    if (z) {
      zone = z.name;
      if (sourceType === 'GENERAL_OCR') sourceType = z.expect;
    }
  }
  const ocrText = [c.plate, c.province, c.text].filter(Boolean).join('\n');
  const plateConfidence = clamp(c.plateConfidence ?? 0);
  const rawProvConf = clamp(c.provinceConfidence ?? c.plateConfidence ?? 0);
  const base = {
    ...c,
    sourceType,
    index,
    ocrText,
    plateConfidence,
    zone,
  };

  let parsed: ParsedText | null = null;
  if (c.plate) {
    const p = parsePlateText(c.plate);
    if (p) parsed = { ...p, provinceRaw: normalizeOcr(c.province ?? '').replace(/[\s0-9-]/g, '') || p.provinceRaw };
  }
  if (!parsed && c.text) parsed = parsePlateText(c.text);

  if (!parsed) {
    return {
      ...base,
      valid: false,
      rejectReason: 'NO_PLATE_PATTERN',
      prefix: '',
      number: '',
      provinceCode: null,
      provinceName: null,
      provinceRaw: '',
      provinceSuggestions: [],
      provinceCorrected: false,
      provinceConfidence: 0,
      plateText: '',
      fullText: '',
      key: '',
    };
  }
  const prov = resolveProvince(parsed.provinceRaw, rawProvConf, policy);
  const plateText = formatPlate(parsed.prefix, parsed.number);
  return {
    ...base,
    valid: true,
    prefix: parsed.prefix,
    number: parsed.number,
    provinceRaw: parsed.provinceRaw,
    provinceCode: prov.code,
    provinceName: prov.name,
    provinceSuggestions: prov.suggestions,
    provinceCorrected: prov.corrected,
    provinceConfidence: prov.code ? prov.confidence : Math.min(prov.confidence, rawProvConf),
    plateText,
    fullText: prov.name ? `${plateText} ${prov.name}` : plateText,
    key: plateKey(parsed.prefix, parsed.number, prov.code),
  };
}

function clamp(n: number): number {
  if (!Number.isFinite(n)) return 0;
  // Accept 0..1 floats from engines that report probabilities.
  const v = n <= 1 && n > 0 ? n * 100 : n;
  return Math.max(0, Math.min(100, Math.round(v * 10) / 10));
}

export function identify(
  raw: RawCandidate[],
  policy: LprPolicy = DEFAULT_LPR_POLICY,
  zones: DetectionZone[] = [],
): IdentificationResult {
  const candidates = raw.map((c, i) => evaluateCandidate(c, i, policy, zones));
  const reasons: string[] = [];
  const rank = (t: SourceType) => {
    const i = policy.priority.indexOf(t);
    return i === -1 ? policy.priority.length : i;
  };
  const valid = candidates
    .filter((c) => c.valid)
    .sort((a, b) => rank(a.sourceType) - rank(b.sourceType) || b.plateConfidence - a.plateConfidence);

  if (!valid.length) {
    return { candidates, selectedIndex: null, selected: null, decision: 'NO_READ', conflict: false, reviewRequired: true, reasons: ['NO_VALID_CANDIDATE'] };
  }
  const selected = valid[0];
  const distinct = new Set(
    valid.filter((c) => c.plateConfidence >= policy.kioskConfirmMin).map((c) => `${c.prefix}|${c.number}|${c.provinceCode ?? ''}`),
  );
  const conflict = distinct.size > 1;
  if (conflict) reasons.push('MULTIPLE_DIFFERENT_PLATES');

  let decision: Decision;
  const provinceKnown = selected.provinceCode !== null;
  if (!provinceKnown) reasons.push('PROVINCE_UNREADABLE');
  if (selected.provinceCorrected) reasons.push('PROVINCE_CORRECTED');

  if (selected.plateConfidence < policy.kioskConfirmMin) {
    decision = 'MANUAL_REVIEW';
    reasons.push('LOW_PLATE_CONFIDENCE');
  } else if (!provinceKnown && policy.requireProvince) {
    decision = 'MANUAL_REVIEW';
  } else if (conflict && policy.conflictPolicy === 'REVIEW') {
    decision = 'MANUAL_REVIEW';
  } else if (
    selected.plateConfidence >= policy.autoConfirmMin &&
    provinceKnown &&
    selected.provinceConfidence >= policy.autoConfirmMin &&
    !conflict
  ) {
    decision = 'AUTO_CONFIRM';
  } else {
    decision = 'KIOSK_CONFIRM';
    if (provinceKnown && selected.provinceConfidence < policy.autoConfirmMin) reasons.push('LOW_PROVINCE_CONFIDENCE');
  }
  const reviewRequired = decision === 'MANUAL_REVIEW' || !provinceKnown || conflict || selected.provinceCorrected;
  return { candidates, selectedIndex: selected.index, selected, decision, conflict, reviewRequired, reasons };
}

/** Build a manual-entry plate (staff typed). */
export function manualPlate(prefix: string, number: string, province: string | null) {
  const p = provinceByCode(province ?? undefined) ?? provinceByName(province ?? undefined);
  const plateText = formatPlate(prefix.replace(/\s/g, ''), String(parseInt(number, 10)));
  return {
    prefix: prefix.replace(/\s/g, ''),
    number: String(parseInt(number, 10)),
    provinceCode: p?.code ?? null,
    provinceName: p?.th ?? null,
    plateText,
    fullText: p ? `${plateText} ${p.th}` : plateText,
    key: plateKey(prefix, number, p?.code ?? null),
  };
}
