/**
 * Audit Log Route
 * Mounted at /api/shop/audit-logs
 *
 * GET /api/shop/audit-logs — query system audit logs with filters
 */
import express from 'express';
import { AuditLog } from '../utils/auditLog.js';
import { authenticate, requireAnyAdmin } from '../middleware/auth.js';

const router = express.Router();
router.use(authenticate);

router.get('/', requireAnyAdmin, async (req, res) => {
  try {
    const filter: any = {};
    if (req.query.action)     filter.action = req.query.action;
    if (req.query.collection) filter.collection = req.query.collection;
    if (req.query.userId)     filter.userId = req.query.userId;
    if (req.query.from || req.query.to) {
      filter.createdAt = {};
      if (req.query.from) filter.createdAt.$gte = new Date(String(req.query.from));
      if (req.query.to)   filter.createdAt.$lte = new Date(String(req.query.to));
    }

    const logs = await AuditLog.find(filter)
      .sort({ createdAt: -1 })
      .limit(Number(req.query.limit) || 100);

    res.json(logs);
  } catch (e: any) {
    console.error('[audit GET]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
