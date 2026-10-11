import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';

const root = path.resolve(import.meta.dirname, '..');
const dataDir = process.env.DATA_DIR ?? path.join(root, 'data');
fs.mkdirSync(dataDir, { recursive: true });

function secret(name: string): string {
  const v = process.env[name];
  if (v) return v;
  // Persist a generated secret so restarts keep tokens/signatures valid.
  const f = path.join(dataDir, `.${name.toLowerCase()}`);
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  const s = crypto.randomBytes(32).toString('base64url');
  fs.writeFileSync(f, s, { mode: 0o600 });
  return s;
}

export const config = {
  port: Number(process.env.PORT ?? 8080),
  env: process.env.NODE_ENV ?? 'development',
  dataDir,
  dbFile: process.env.DB_FILE ?? path.join(dataDir, 'parking.db'),
  uploadDir: process.env.UPLOAD_DIR ?? path.join(dataDir, 'uploads'),
  backupDir: path.join(dataDir, 'backups'),
  webDist: path.resolve(root, '..', 'web', 'dist'),
  /** Public base URL printed into QR codes (customer website). */
  publicUrl: process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 8080}`,
  appSecret: secret('APP_SECRET'),
  tokenTtlHours: Number(process.env.TOKEN_TTL_HOURS ?? 12),
  payment: {
    provider: process.env.PAYMENT_PROVIDER ?? 'mock', // mock | omise
    mockWebhookSecret: process.env.MOCK_WEBHOOK_SECRET ?? secret('MOCK_WEBHOOK_SECRET'),
    omiseSecretKey: process.env.OMISE_SECRET_KEY ?? '',
    omisePublicKey: process.env.OMISE_PUBLIC_KEY ?? '',
    promptPayId: process.env.PROMPTPAY_ID ?? '0812345678',
    qrExpiryMinutes: Number(process.env.PAYMENT_QR_EXPIRY_MIN ?? 10),
  },
};
fs.mkdirSync(config.uploadDir, { recursive: true });
fs.mkdirSync(config.backupDir, { recursive: true });
