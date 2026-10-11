import { Router } from 'express';
import { q } from '../db/index.ts';
import { h } from '../lib/http.ts';
import { requireUser } from '../auth/middleware.ts';

export const router = Router();

/** Badge counters for the admin navigation. */
router.get(
  '/counts',
  requireUser,
  h((_req, res) => {
    res.json({
      review: q.get<{ n: number }>("SELECT COUNT(*) n FROM detections WHERE review_status='PENDING'")!.n,
      alerts: q.get<{ n: number }>('SELECT COUNT(*) n FROM alerts WHERE resolved_at IS NULL AND acknowledged_at IS NULL')!.n,
    });
  }),
);
