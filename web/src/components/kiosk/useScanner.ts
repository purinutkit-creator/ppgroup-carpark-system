/**
 * Keyboard-wedge (HID) barcode / QR scanner listener.
 *
 * USB/serial-HID scanners "type" the code very fast and finish with Enter.
 * We capture keystrokes on window even when nothing is focused, so kiosks
 * work without a visible input. Keystrokes typed into a real text field are
 * left alone (that field handles its own Enter) unless the field opts in
 * with `data-scanner="capture"`.
 *
 * Thai keyboard layout: when the OS layout is Thai, a scanner sends Thai
 * characters for the same physical keys ("PV1" arrives as "ญฤๅ"). We rebuild
 * the intended ASCII character from KeyboardEvent.code so codes still decode.
 */
import { useEffect, useRef } from 'react';

const SHIFT_DIGITS = ')!@#$%^&*(';
const PUNCT: Record<string, [string, string]> = {
  Minus: ['-', '_'],
  Equal: ['=', '+'],
  BracketLeft: ['[', '{'],
  BracketRight: [']', '}'],
  Backslash: ['\\', '|'],
  Semicolon: [';', ':'],
  Quote: ["'", '"'],
  Comma: [',', '<'],
  Period: ['.', '>'],
  Slash: ['/', '?'],
  Backquote: ['`', '~'],
  Space: [' ', ' '],
};

/** ASCII character for a key event, using the physical key when the layout is not Latin. */
export function asciiFromKey(e: KeyboardEvent): string | null {
  if (e.key.length === 1 && e.key.charCodeAt(0) < 128) return e.key;
  const c = e.code;
  if (/^Key[A-Z]$/.test(c)) {
    const ch = c.slice(3);
    // CapsLock state is unknown for non-Latin layouts; tokens are case-sensitive, so trust Shift.
    return e.shiftKey ? ch : ch.toLowerCase();
  }
  if (/^Digit\d$/.test(c)) return e.shiftKey ? SHIFT_DIGITS[Number(c[5])] : c[5];
  if (/^Numpad\d$/.test(c)) return c[6];
  if (PUNCT[c]) return PUNCT[c][e.shiftKey ? 1 : 0];
  return e.key.length === 1 ? e.key : null;
}

function isEditable(el: EventTarget | null) {
  const n = el as HTMLElement | null;
  if (!n || !n.tagName) return false;
  if (n.dataset?.scanner === 'capture') return false;
  return n.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(n.tagName);
}

export interface ScannerOptions {
  enabled?: boolean;
  /** Minimum code length to accept. */
  minLength?: number;
  /** Max gap between characters of one scan (ms). Humans typing are slower. */
  maxGapMs?: number;
}

export function useScanner(onScan: (code: string) => void, { enabled = true, minLength = 4, maxGapMs = 120 }: ScannerOptions = {}) {
  const cb = useRef(onScan);
  cb.current = onScan;
  useEffect(() => {
    if (!enabled) return;
    let buf = '';
    let last = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (isEditable(e.target)) return;
      const now = performance.now();
      if (now - last > maxGapMs) buf = '';
      last = now;
      if (e.key === 'Enter' || e.key === 'Tab') {
        const code = buf.trim();
        buf = '';
        if (code.length >= minLength) {
          e.preventDefault();
          cb.current(code);
        }
        return;
      }
      const ch = asciiFromKey(e);
      if (ch) {
        buf += ch;
        // keep space from scrolling the page while a code streams in
        if (ch === ' ') e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [enabled, minLength, maxGapMs]);
}

/** Normalise a scanned string typed into a text field under a Thai layout (best effort). */
const THAI_TO_US: Record<string, string> = (() => {
  // Kedmanee unshifted / shifted rows mapped to US QWERTY.
  const th = 'ๅ/-ภถุึคตจขชๆไำพะัีรนยบลฃฟหกดเ้่าสวงผปแอิืทมใฝ' + '+๑๒๓๔ู฿๕๖๗๘๙๐"ฎฑธํ๊ณฯญฐ,ฅฤฆฏโฌ็๋ษศซ.()ฉฮฺ์?ฒฬฦ';
  const us = "1234567890-=qwertyuiop[]\\asdfghjkl;'zxcvbnm,./" + '!@#$%^&*()_+QWERTYUIOP{}|ASDFGHJKL:"ZXCVBNM<>?';
  const m: Record<string, string> = {};
  for (let i = 0; i < Math.min(th.length, us.length); i++) m[th[i]] = us[i];
  return m;
})();

/** Undo Thai-layout garbling for receipt / ticket codes (which are ASCII only). */
export function deThai(s: string) {
  if (!/[฀-๿]/.test(s)) return s;
  return [...s].map((c) => THAI_TO_US[c] ?? c).join('');
}
