/**
 * On-screen keyboard for Thai licence plates: consonants ก–ฮ (ฃ/ฅ are not
 * used on plates) + digits. Large touch targets for kiosks.
 */
export const PLATE_CONSONANTS = 'กขคฆงจฉชซฌญฎฏฐฑฒณดตถทธนบปผฝพฟภมยรลวศษสหฬอฮ'.split('');
const DIGITS = '1234567890'.split('');

export function ThaiKeyboard({
  onKey,
  onBackspace,
  onClear,
  digits = true,
  consonants = true,
  el,
}: {
  onKey: (ch: string) => void;
  onBackspace: () => void;
  onClear?: () => void;
  digits?: boolean;
  consonants?: boolean;
  /** data-el path for the key labels */
  el?: string;
}) {
  return (
    <div className="tkb">
      {digits && (
        <div className="tkb-digits">
          {DIGITS.map((d) => (
            <button key={d} type="button" className="tkb-key tkb-digit" data-el={el} onClick={() => onKey(d)}>
              {d}
            </button>
          ))}
        </div>
      )}
      {consonants && (
        <div className="tkb-cons">
          {PLATE_CONSONANTS.map((c) => (
            <button key={c} type="button" className="tkb-key" data-el={el} onClick={() => onKey(c)}>
              {c}
            </button>
          ))}
        </div>
      )}
      <div className="tkb-actions">
        {onClear && (
          <button type="button" className="tkb-key tkb-wide" onClick={onClear}>
            ล้าง
          </button>
        )}
        <button type="button" className="tkb-key tkb-wide" onClick={onBackspace} aria-label="backspace">
          ⌫
        </button>
      </div>
    </div>
  );
}

/** Split "1กข1234" into prefix "1กข" + number "1234"; null if incomplete. */
export function parsePlateInput(v: string): { prefix: string; number: string } | null {
  const m = /^(\d?[ก-ฮ]{1,3})(\d{1,4})$/.exec(v.replace(/\s/g, ''));
  return m ? { prefix: m[1], number: m[2] } : null;
}

/** Accept a key only if the plate input stays a valid prefix of "[digit]letters(1-3)digits(1-4)". */
export function acceptPlateKey(cur: string, ch: string): string {
  const next = cur + ch;
  return /^(\d?([ก-ฮ]{1,3}(\d{0,4})?)?)$/.test(next) ? next : cur;
}

/** "1กข1234" → "1กข 1234" */
export function formatPlateInput(v: string) {
  const m = /^(\d?[ก-ฮ]{1,3})(\d*)$/.exec(v);
  return m && m[2] ? `${m[1]} ${m[2]}` : v;
}
