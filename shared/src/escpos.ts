/**
 * ESC/POS encoder. Thai and custom fonts are not reliably supported by printer
 * firmware, so print content is rendered to a bitmap (in the browser with the
 * configured web fonts, or on the edge agent) and sent as a raster image
 * (GS v 0). Widths: 58 mm ≈ 384 dots, 80 mm ≈ 576 dots at 203 dpi.
 */

export const PAPER_DOTS: Record<'58' | '80', number> = { '58': 384, '80': 576 };

export class EscPos {
  private chunks: number[] = [];

  init() {
    this.chunks.push(0x1b, 0x40);
    return this;
  }
  align(a: 'left' | 'center' | 'right') {
    this.chunks.push(0x1b, 0x61, a === 'left' ? 0 : a === 'center' ? 1 : 2);
    return this;
  }
  feed(lines = 1) {
    this.chunks.push(0x1b, 0x64, Math.max(0, Math.min(255, lines)));
    return this;
  }
  cut(partial = true) {
    this.chunks.push(0x1d, 0x56, partial ? 0x42 : 0x41, 0x00);
    return this;
  }
  /** ASCII-only text (for Latin content on printers without bitmap mode). */
  text(s: string) {
    for (const ch of s) {
      const c = ch.charCodeAt(0);
      this.chunks.push(c < 128 ? c : 0x3f);
    }
    return this;
  }
  /** Kick cash drawer (pin 2). */
  drawer() {
    this.chunks.push(0x1b, 0x70, 0x00, 0x19, 0xfa);
    return this;
  }
  /**
   * Monochrome raster from RGBA pixels. Pixels darker than `threshold` print.
   * Uses Floyd–Steinberg dithering for photos/logos when `dither` is true.
   */
  raster(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, opts: { threshold?: number; dither?: boolean } = {}) {
    const threshold = opts.threshold ?? 160;
    const gray = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) {
      const a = rgba[i * 4 + 3] / 255;
      const lum = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
      gray[i] = lum * a + 255 * (1 - a);
    }
    const bytesPerRow = Math.ceil(width / 8);
    const out = new Uint8Array(bytesPerRow * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const old = gray[i];
        const black = old < threshold;
        if (black) out[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
        if (opts.dither) {
          const err = old - (black ? 0 : 255);
          if (x + 1 < width) gray[i + 1] += (err * 7) / 16;
          if (y + 1 < height) {
            if (x > 0) gray[i + width - 1] += (err * 3) / 16;
            gray[i + width] += (err * 5) / 16;
            if (x + 1 < width) gray[i + width + 1] += err / 16;
          }
        }
      }
    }
    // Send in bands of max 255 rows to stay within printer buffer limits.
    for (let y0 = 0; y0 < height; y0 += 255) {
      const h = Math.min(255, height - y0);
      this.chunks.push(0x1d, 0x76, 0x30, 0x00, bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff, h & 0xff, (h >> 8) & 0xff);
      const band = out.subarray(y0 * bytesPerRow, (y0 + h) * bytesPerRow);
      for (const b of band) this.chunks.push(b);
    }
    return this;
  }
  bytes(): Uint8Array {
    return Uint8Array.from(this.chunks);
  }
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
