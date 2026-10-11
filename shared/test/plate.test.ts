import { describe, expect, it } from 'vitest';
import { identify, parsePlateText, plateKey, suggestProvinces, DEFAULT_LPR_POLICY, evaluateCandidate } from '../src/index.ts';

describe('parsePlateText', () => {
  it('parses single-line plate with province', () => {
    expect(parsePlateText('1กข 1234 กรุงเทพมหานคร')).toEqual({ prefix: '1กข', number: '1234', provinceRaw: 'กรุงเทพมหานคร' });
  });
  it('parses multi-line paper sign', () => {
    expect(parsePlateText('กข 5678\nชลบุรี')).toEqual({ prefix: 'กข', number: '5678', provinceRaw: 'ชลบุรี' });
  });
  it('normalises Thai digits and Latin OCR confusions', () => {
    expect(parsePlateText('กข ๑๒๓๔')?.number).toBe('1234');
    expect(parsePlateText('กข 12O4')?.number).toBe('1204');
  });
  it('handles motorcycle style three-letter prefix', () => {
    expect(parsePlateText('กขค 123 เชียงใหม่')).toMatchObject({ prefix: 'กขค', number: '123', provinceRaw: 'เชียงใหม่' });
  });
  it('returns null when there is no plate pattern', () => {
    expect(parsePlateText('ร้านกาแฟ')).toBeNull();
  });
});

describe('province matching', () => {
  it('suggests the closest province for OCR typos', () => {
    expect(suggestProvinces('ชลบุรื')[0]).toMatchObject({ th: 'ชลบุรี' });
  });
  it('recognises aliases', () => {
    expect(suggestProvinces('กทม')[0]).toMatchObject({ code: '10', similarity: 1 });
  });
  it('keeps the raw text and only corrects with enough confidence', () => {
    const hi = evaluateCandidate({ sourceType: 'REAL_PLATE', plate: 'กข1234', province: 'ชลบุรื', plateConfidence: 95, provinceConfidence: 90 }, 0);
    expect(hi.provinceCode).toBe('20');
    expect(hi.provinceCorrected).toBe(true);
    expect(hi.provinceRaw).toBe('ชลบุรื');
    const lo = evaluateCandidate({ sourceType: 'REAL_PLATE', plate: 'กข1234', province: 'ชลบุรื', plateConfidence: 95, provinceConfidence: 31 }, 0);
    expect(lo.provinceCode).toBeNull();
    expect(lo.provinceSuggestions[0].th).toBe('ชลบุรี');
  });
});

describe('plate keys', () => {
  it('distinguishes the same letters/number in different provinces', () => {
    expect(plateKey('กข', '1234', '10')).not.toBe(plateKey('กข', '1234', '20'));
    expect(plateKey('กข', '0012', null)).toBe('กข|12|?');
  });
});

describe('identify (multi-source)', () => {
  const real = { sourceType: 'REAL_PLATE' as const, plate: 'กข1234', province: 'กรุงเทพมหานคร', plateConfidence: 97, provinceConfidence: 96 };
  const paper = { sourceType: 'PAPER_SIGN' as const, text: 'กข 5678\nชลบุรี', plateConfidence: 91, provinceConfidence: 90 };

  it('auto-confirms a single high-confidence read', () => {
    const r = identify([real]);
    expect(r.decision).toBe('AUTO_CONFIRM');
    expect(r.selected?.fullText).toBe('กข 1234 กรุงเทพมหานคร');
  });
  it('never picks randomly between conflicting plates: follows priority and flags conflict', () => {
    const a = identify([paper, real], { ...DEFAULT_LPR_POLICY, priority: ['REAL_PLATE', 'TEMPORARY_PLATE', 'PAPER_SIGN'] });
    expect(a.selected?.number).toBe('1234');
    expect(a.conflict).toBe(true);
    expect(a.decision).toBe('KIOSK_CONFIRM');
    const b = identify([real, paper], { ...DEFAULT_LPR_POLICY, priority: ['PAPER_SIGN', 'TEMPORARY_PLATE', 'REAL_PLATE'] });
    expect(b.selected?.number).toBe('5678');
    const c = identify([real, paper], { ...DEFAULT_LPR_POLICY, conflictPolicy: 'REVIEW' });
    expect(c.decision).toBe('MANUAL_REVIEW');
  });
  it('applies confidence thresholds', () => {
    expect(identify([{ ...real, plateConfidence: 80 }]).decision).toBe('KIOSK_CONFIRM');
    expect(identify([{ ...real, plateConfidence: 60 }]).decision).toBe('MANUAL_REVIEW');
    expect(identify([{ sourceType: 'GENERAL_OCR', text: 'hello' }]).decision).toBe('NO_READ');
  });
  it('records unreadable province and requests review', () => {
    const r = identify([{ sourceType: 'REAL_PLATE', plate: 'กข1234', province: 'xx', plateConfidence: 97, provinceConfidence: 31 }]);
    expect(r.selected?.provinceCode).toBeNull();
    expect(r.reasons).toContain('PROVINCE_UNREADABLE');
    expect(r.reviewRequired).toBe(true);
    expect(identify([{ sourceType: 'REAL_PLATE', plate: 'กข1234', plateConfidence: 97 }], { ...DEFAULT_LPR_POLICY, requireProvince: true }).decision).toBe('MANUAL_REVIEW');
  });
  it('reclassifies general OCR text by detection zone (Mode C)', () => {
    const r = identify([{ sourceType: 'GENERAL_OCR', text: 'กข 5678 ชลบุรี', plateConfidence: 92, bbox: { x: 0.4, y: 0.2, w: 0.1, h: 0.1 } }], DEFAULT_LPR_POLICY, [
      { name: 'windshield', rect: { x: 0.2, y: 0.1, w: 0.6, h: 0.4 }, expect: 'PAPER_SIGN' },
    ]);
    expect(r.selected?.sourceType).toBe('PAPER_SIGN');
    expect(r.selected?.zone).toBe('windshield');
  });
});
