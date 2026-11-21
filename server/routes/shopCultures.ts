/**
 * Shop Cultures Route — Crop / Culture Cycle Management
 * Mounted at /api/shop/cultures
 *
 * POST /api/shop/cultures             — start new culture
 * GET  /api/shop/cultures             — list cultures
 * GET  /api/shop/cultures/:id         — single culture
 * PUT  /api/shop/cultures/:id/close   — close culture
 * GET  /api/shop/cultures/:id/purchases — culture-wise purchase history
 * GET  /api/shop/farmers/:id/cultures — all cultures for a farmer
 */
import express from 'express';
import { ShopCulture } from '../models/culture.js';
import { ShopFarmer } from '../models/shopFarmer.js';
import { Invoice } from '../db.js';
import { authenticate, requireAnyAdmin } from '../middleware/auth.js';
import { logAudit } from '../utils/auditLog.js';

const router = express.Router();
router.use(authenticate);

// ── POST / — start new culture cycle ──────────────────────────────────────────
router.post('/', async (req: any, res) => {
  try {
    const { farmerId, startDate, notes, allowMultiple } = req.body;
    if (!farmerId) return res.status(400).json({ error: 'farmerId is required' });

    const farmer = await ShopFarmer.findById(farmerId);
    if (!farmer) return res.status(404).json({ error: 'Farmer not found' });

    // Check if farmer already has an active culture
    if (!allowMultiple) {
      const activeCulture = await ShopCulture.findOne({ farmerId, status: 'active' });
      if (activeCulture) {
        return res.status(409).json({
          error: `Farmer already has an active culture (${activeCulture.cultureId}). Close it before starting a new one.`,
          existingCultureId: activeCulture._id,
        });
      }
    }

    const year = new Date().getFullYear();
    const count = await ShopCulture.countDocuments();
    const cultureId = `CULT-${year}-${String(count + 1).padStart(3, '0')}`;

    const culture = await ShopCulture.create({
      cultureId,
      farmerId,
      startDate: startDate ? new Date(startDate) : new Date(),
      status: 'active',
      notes,
      createdBy: req.user.id,
    });

    await logAudit({
      tenantId: req.user.tenantId || 'shop',
      action: 'CULTURE_START',
      userId: req.user.id,
      collection: 'shopculturecycles',
      documentId: culture._id,
      before: null,
      after: culture.toObject(),
    });

    res.status(201).json(culture);
  } catch (e: any) {
    console.error('[shopCultures POST]', e);
    res.status(500).json({ error: 'Server error: ' + e.message });
  }
});

// ── GET / — list cultures ─────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const filter: any = {};
    if (req.query.farmerId) filter.farmerId = req.query.farmerId;
    if (req.query.status)   filter.status = req.query.status;

    const cultures = await ShopCulture.find(filter)
      .populate('farmerId', 'name phoneNumber village')
      .sort({ startDate: -1 });
    res.json(cultures);
  } catch (e: any) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /:id — single culture ─────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const culture = await ShopCulture.findById(req.params.id)
      .populate('farmerId', 'name phoneNumber village address');
    if (!culture) return res.status(404).json({ error: 'Culture not found' });
    res.json(culture);
  } catch (e: any) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── PUT /:id/close — close culture ────────────────────────────────────────────
router.put('/:id/close', requireAnyAdmin, async (req: any, res) => {
  try {
    const culture = await ShopCulture.findById(req.params.id);
    if (!culture) return res.status(404).json({ error: 'Culture not found' });
    if (culture.status === 'closed') {
      return res.status(400).json({ error: 'Culture is already closed' });
    }

    const { endDate, notes } = req.body;
    const before = culture.toObject();

    culture.status = 'closed';
    culture.endDate = endDate ? new Date(endDate) : new Date();
    if (notes) culture.notes = (culture.notes ? culture.notes + ' | ' : '') + notes;
    await culture.save();

    await logAudit({
      tenantId: req.user.tenantId || 'shop',
      action: 'CULTURE_CLOSE',
      userId: req.user.id,
      collection: 'shopculturecycles',
      documentId: culture._id,
      before,
      after: culture.toObject(),
    });

    res.json(culture);
  } catch (e: any) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /:id/purchases — culture-wise purchase history ─────────────────────────
router.get('/:id/purchases', async (req, res) => {
  try {
    const culture = await ShopCulture.findById(req.params.id);
    if (!culture) return res.status(404).json({ error: 'Culture not found' });

    const startDate = culture.startDate;
    const endDate = culture.endDate || new Date();

    const invoices = await Invoice.find({
      farmerId: culture.farmerId.toString(),
      status: { $ne: 'cancelled' },
      createdAt: { $gte: startDate, $lte: endDate },
    })
      .populate('items.productId', 'name code unit category')
      .sort({ createdAt: 1 });

    const totalPurchased = invoices.reduce((sum, inv) => sum + (inv.totalAmount || 0), 0);

    res.json({
      cultureId: culture.cultureId,
      status: culture.status,
      startDate: culture.startDate,
      endDate: culture.endDate,
      invoices,
      totalPurchased,
      billCount: invoices.length,
    });
  } catch (e: any) {
    console.error('[shopCultures purchases GET]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
