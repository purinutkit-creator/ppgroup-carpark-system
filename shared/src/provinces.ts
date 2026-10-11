/**
 * Thai provinces (77) + special plate regions, used to validate and correct
 * OCR output of the province line on Thai licence plates.
 */
export interface Province {
  code: string;       // stable short code used in plate keys (ISO 3166-2:TH numeric suffix)
  th: string;
  en: string;
  aliases?: string[]; // common OCR / abbreviated variants
}

export const PROVINCES: Province[] = [
  { code: '10', th: 'กรุงเทพมหานคร', en: 'Bangkok', aliases: ['กรุงเทพ', 'กทม', 'กรุงเทพฯ'] },
  { code: '11', th: 'สมุทรปราการ', en: 'Samut Prakan' },
  { code: '12', th: 'นนทบุรี', en: 'Nonthaburi' },
  { code: '13', th: 'ปทุมธานี', en: 'Pathum Thani' },
  { code: '14', th: 'พระนครศรีอยุธยา', en: 'Phra Nakhon Si Ayutthaya', aliases: ['อยุธยา'] },
  { code: '15', th: 'อ่างทอง', en: 'Ang Thong' },
  { code: '16', th: 'ลพบุรี', en: 'Lop Buri' },
  { code: '17', th: 'สิงห์บุรี', en: 'Sing Buri' },
  { code: '18', th: 'ชัยนาท', en: 'Chai Nat' },
  { code: '19', th: 'สระบุรี', en: 'Saraburi' },
  { code: '20', th: 'ชลบุรี', en: 'Chon Buri' },
  { code: '21', th: 'ระยอง', en: 'Rayong' },
  { code: '22', th: 'จันทบุรี', en: 'Chanthaburi' },
  { code: '23', th: 'ตราด', en: 'Trat' },
  { code: '24', th: 'ฉะเชิงเทรา', en: 'Chachoengsao' },
  { code: '25', th: 'ปราจีนบุรี', en: 'Prachin Buri' },
  { code: '26', th: 'นครนายก', en: 'Nakhon Nayok' },
  { code: '27', th: 'สระแก้ว', en: 'Sa Kaeo' },
  { code: '30', th: 'นครราชสีมา', en: 'Nakhon Ratchasima', aliases: ['โคราช'] },
  { code: '31', th: 'บุรีรัมย์', en: 'Buri Ram' },
  { code: '32', th: 'สุรินทร์', en: 'Surin' },
  { code: '33', th: 'ศรีสะเกษ', en: 'Si Sa Ket' },
  { code: '34', th: 'อุบลราชธานี', en: 'Ubon Ratchathani' },
  { code: '35', th: 'ยโสธร', en: 'Yasothon' },
  { code: '36', th: 'ชัยภูมิ', en: 'Chaiyaphum' },
  { code: '37', th: 'อำนาจเจริญ', en: 'Amnat Charoen' },
  { code: '38', th: 'บึงกาฬ', en: 'Bueng Kan' },
  { code: '39', th: 'หนองบัวลำภู', en: 'Nong Bua Lam Phu' },
  { code: '40', th: 'ขอนแก่น', en: 'Khon Kaen' },
  { code: '41', th: 'อุดรธานี', en: 'Udon Thani' },
  { code: '42', th: 'เลย', en: 'Loei' },
  { code: '43', th: 'หนองคาย', en: 'Nong Khai' },
  { code: '44', th: 'มหาสารคาม', en: 'Maha Sarakham' },
  { code: '45', th: 'ร้อยเอ็ด', en: 'Roi Et' },
  { code: '46', th: 'กาฬสินธุ์', en: 'Kalasin' },
  { code: '47', th: 'สกลนคร', en: 'Sakon Nakhon' },
  { code: '48', th: 'นครพนม', en: 'Nakhon Phanom' },
  { code: '49', th: 'มุกดาหาร', en: 'Mukdahan' },
  { code: '50', th: 'เชียงใหม่', en: 'Chiang Mai' },
  { code: '51', th: 'ลำพูน', en: 'Lamphun' },
  { code: '52', th: 'ลำปาง', en: 'Lampang' },
  { code: '53', th: 'อุตรดิตถ์', en: 'Uttaradit' },
  { code: '54', th: 'แพร่', en: 'Phrae' },
  { code: '55', th: 'น่าน', en: 'Nan' },
  { code: '56', th: 'พะเยา', en: 'Phayao' },
  { code: '57', th: 'เชียงราย', en: 'Chiang Rai' },
  { code: '58', th: 'แม่ฮ่องสอน', en: 'Mae Hong Son' },
  { code: '60', th: 'นครสวรรค์', en: 'Nakhon Sawan' },
  { code: '61', th: 'อุทัยธานี', en: 'Uthai Thani' },
  { code: '62', th: 'กำแพงเพชร', en: 'Kamphaeng Phet' },
  { code: '63', th: 'ตาก', en: 'Tak' },
  { code: '64', th: 'สุโขทัย', en: 'Sukhothai' },
  { code: '65', th: 'พิษณุโลก', en: 'Phitsanulok' },
  { code: '66', th: 'พิจิตร', en: 'Phichit' },
  { code: '67', th: 'เพชรบูรณ์', en: 'Phetchabun' },
  { code: '70', th: 'ราชบุรี', en: 'Ratchaburi' },
  { code: '71', th: 'กาญจนบุรี', en: 'Kanchanaburi' },
  { code: '72', th: 'สุพรรณบุรี', en: 'Suphan Buri' },
  { code: '73', th: 'นครปฐม', en: 'Nakhon Pathom' },
  { code: '74', th: 'สมุทรสาคร', en: 'Samut Sakhon' },
  { code: '75', th: 'สมุทรสงคราม', en: 'Samut Songkhram' },
  { code: '76', th: 'เพชรบุรี', en: 'Phetchaburi' },
  { code: '77', th: 'ประจวบคีรีขันธ์', en: 'Prachuap Khiri Khan' },
  { code: '80', th: 'นครศรีธรรมราช', en: 'Nakhon Si Thammarat' },
  { code: '81', th: 'กระบี่', en: 'Krabi' },
  { code: '82', th: 'พังงา', en: 'Phangnga' },
  { code: '83', th: 'ภูเก็ต', en: 'Phuket' },
  { code: '84', th: 'สุราษฎร์ธานี', en: 'Surat Thani' },
  { code: '85', th: 'ระนอง', en: 'Ranong' },
  { code: '86', th: 'ชุมพร', en: 'Chumphon' },
  { code: '90', th: 'สงขลา', en: 'Songkhla' },
  { code: '91', th: 'สตูล', en: 'Satun' },
  { code: '92', th: 'ตรัง', en: 'Trang' },
  { code: '93', th: 'พัทลุง', en: 'Phatthalung' },
  { code: '94', th: 'ปัตตานี', en: 'Pattani' },
  { code: '95', th: 'ยะลา', en: 'Yala' },
  { code: '96', th: 'นราธิวาส', en: 'Narathiwat' },
  // Special plate region (Betong district, Yala) issues its own plates.
  { code: '95B', th: 'เบตง', en: 'Betong' },
];

export const UNKNOWN_PROVINCE = '?';

const byCode = new Map(PROVINCES.map((p) => [p.code, p]));
const byName = new Map<string, Province>();
for (const p of PROVINCES) {
  byName.set(p.th, p);
  byName.set(p.en.toLowerCase(), p);
  for (const a of p.aliases ?? []) byName.set(a, p);
}

export function provinceByCode(code: string | null | undefined): Province | undefined {
  return code ? byCode.get(code) : undefined;
}

export function provinceByName(name: string | null | undefined): Province | undefined {
  if (!name) return undefined;
  const n = name.trim().replace(/\s+/g, '');
  return byName.get(n) ?? byName.get(n.toLowerCase());
}

/** Levenshtein distance over Unicode code points (Thai combining marks count as chars). */
export function levenshtein(a: string, b: string): number {
  const A = Array.from(a);
  const B = Array.from(b);
  if (!A.length) return B.length;
  if (!B.length) return A.length;
  let prev = new Array(B.length + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= A.length; i++) {
    const cur = [i];
    for (let j = 1; j <= B.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (A[i - 1] === B[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[B.length];
}

export interface ProvinceSuggestion {
  code: string;
  th: string;
  similarity: number; // 0..1
}

/** Rank provinces by similarity to an OCR string. Exact/alias matches score 1. */
export function suggestProvinces(raw: string, limit = 3): ProvinceSuggestion[] {
  const text = raw.trim().replace(/\s+/g, '');
  if (!text) return [];
  const exact = provinceByName(text);
  if (exact) return [{ code: exact.code, th: exact.th, similarity: 1 }];
  const scored: ProvinceSuggestion[] = [];
  for (const p of PROVINCES) {
    let best = 0;
    for (const name of [p.th, ...(p.aliases ?? [])]) {
      const len = Math.max(Array.from(name).length, Array.from(text).length);
      const sim = 1 - levenshtein(name, text) / len;
      if (sim > best) best = sim;
    }
    scored.push({ code: p.code, th: p.th, similarity: Math.round(best * 1000) / 1000 });
  }
  return scored.sort((x, y) => y.similarity - x.similarity).slice(0, limit);
}
