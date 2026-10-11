import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { config } from './config.ts';
import { authenticate } from './auth/middleware.ts';
import { errorHandler } from './lib/http.ts';
import { router as auth } from './routes/auth.ts';
import { router as pub } from './routes/public.ts';
import { router as gates } from './routes/gates.ts';
import { router as sessions } from './routes/sessions.ts';
import { router as validation } from './routes/validation.ts';
import { router as payments } from './routes/payments.ts';
import { router as kiosk } from './routes/kiosk.ts';
import { router as edge } from './routes/edge.ts';
import { router as devices } from './routes/devices.ts';
import { router as admin } from './routes/admin.ts';
import { router as reports } from './routes/reports.ts';
import { router as merchants } from './routes/merchants.ts';
import { router as pos } from './routes/pos.ts';
import { router as appearance } from './routes/appearance.ts';
import { router as media } from './routes/media.ts';

export function createApp() {
  const app = express();
  app.set('trust proxy', true);
  app.disable('x-powered-by');
  app.use(
    express.json({
      limit: '15mb',
      verify: (req, _res, buf) => {
        (req as unknown as { rawBody: Buffer }).rawBody = buf; // payment webhook signatures
      },
    }),
  );
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });
  app.use(authenticate);

  app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));
  app.use('/api/auth', auth);
  app.use('/api/public', pub);
  app.use('/api', gates);
  app.use('/api/sessions', sessions);
  app.use('/api/validation', validation);
  app.use('/api/payments', payments);
  app.use('/api/kiosk', kiosk);
  app.use('/api/edge', edge);
  app.use('/api/devices', devices);
  app.use('/api/admin', admin);
  app.use('/api/reports', reports);
  app.use('/api/merchants', merchants);
  app.use('/api/pos', pos);
  app.use('/api/appearance', appearance);
  app.use('/api/media', media);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'NOT_FOUND' }));

  // Public uploads (logos, banners, fonts, product images). LPR images live under
  // uploads/private and are only served through /api/images with permission checks.
  app.use('/uploads', (req, res, next) => {
    if (req.path.startsWith('/private')) return res.status(404).end();
    next();
  }, express.static(config.uploadDir, { maxAge: '7d', fallthrough: false }));

  if (fs.existsSync(config.webDist)) {
    app.use(express.static(config.webDist, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api|socket\.io|uploads).*/, (_req, res) => res.sendFile(path.join(config.webDist, 'index.html')));
  }
  app.use(errorHandler);
  return app;
}
