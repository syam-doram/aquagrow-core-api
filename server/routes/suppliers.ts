/**
 * Suppliers Route — ERP supplier management
 * Mounted at /api/suppliers in index.ts
 *
 * GET    /api/suppliers              — list active suppliers (q=search)
 * GET    /api/suppliers/:id          — single supplier
 * POST   /api/suppliers              — create supplier (requireAnyAdmin)
 * PUT    /api/suppliers/:id          — update supplier (requireAnyAdmin)
 * DELETE /api/suppliers/:id          — soft delete, isActive=false (requireSuperAdmin)
 * GET    /api/suppliers/:id/ledger   — PO-based ledger for supplier
 */
import express from 'express';
import { Supplier } from '../models/supplier.js';
import { PurchaseOrder } from '../models/purchaseOrder.js';
import { authenticate, requireAnyAdmin, requireSuperAdmin } from '../middleware/auth.js';

const router = express.Router();
router.use(authenticate);

// ── GET / — list active suppliers ─────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const filter: any = { isActive: true };
    if (req.query.q) {
      const regex = new RegExp(String(req.query.q), 'i');
      filter.$or = [{ name: regex }, { phoneNumber: regex }];
    }
    const suppliers = await Supplier.find(filter).sort({ name: 1 });
    res.json(suppliers);
  } catch (e: any) {
    console.error('[suppliers GET]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /:id — single supplier ────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const supplier = await Supplier.findById(req.params.id);
    if (!supplier) return res.status(404).json({ error: 'Supplier not found' });
    res.json(supplier);
  } catch (e: any) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /:id/ledger — supplier purchase ledger ────────────────────────────────
router.get('/:id/ledger', requireAnyAdmin, async (req, res) => {
  try {
    const supplier = await Supplier.findById(req.params.id);
    if (!supplier) return res.status(404).json({ error: 'Supplier not found' });

    const pos = await PurchaseOrder.find({ supplierId: req.params.id })
      .select('poNumber orderDate totalExpectedAmount paymentStatus status')
      .sort({ orderDate: -1 });

    const totalPurchased = pos.reduce((sum, po) => sum + (po.totalExpectedAmount || 0), 0);

    // Paid = POs with paymentStatus 'paid'; partial = estimate from PO amounts
    const totalPaid = pos.reduce((sum, po) => {
      if (po.paymentStatus === 'paid') return sum + (po.totalExpectedAmount || 0);
      return sum;
    }, 0);

    const outstanding = totalPurchased - totalPaid;

    res.json({
      supplierId: supplier._id,
      supplierName: supplier.name,
      purchases: pos.map(po => ({
        poNumber: po.poNumber,
        orderDate: po.orderDate,
        totalExpectedAmount: po.totalExpectedAmount,
        paymentStatus: po.paymentStatus,
        status: po.status,
      })),
      totalPurchased,
      totalPaid,
      outstanding,
    });
  } catch (e: any) {
    console.error('[suppliers ledger]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST / — create supplier ──────────────────────────────────────────────────
router.post('/', requireAnyAdmin, async (req: any, res) => {
  try {
    const { name, phoneNumber, email, address, gstin, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    const supplier = await Supplier.create({
      name,
      phoneNumber,
      email,
      address,
      gstin,
      notes,
    });
    res.status(201).json(supplier);
  } catch (e: any) {
    console.error('[suppliers POST]', e);
    if (e.code === 11000) return res.status(409).json({ error: 'Supplier already exists' });
    res.status(500).json({ error: 'Server error' });
  }
});

// ── PUT /:id — update supplier ────────────────────────────────────────────────
router.put('/:id', requireAnyAdmin, async (req, res) => {
  try {
    const { name, phoneNumber, email, address, gstin, notes, isActive } = req.body;
    const supplier = await Supplier.findByIdAndUpdate(
      req.params.id,
      { name, phoneNumber, email, address, gstin, notes, isActive },
      { new: true, runValidators: true }
    );
    if (!supplier) return res.status(404).json({ error: 'Supplier not found' });
    res.json(supplier);
  } catch (e: any) {
    console.error('[suppliers PUT]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── DELETE /:id — soft delete (superAdmin only) ───────────────────────────────
router.delete('/:id', requireSuperAdmin, async (req, res) => {
  try {
    const supplier = await Supplier.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    );
    if (!supplier) return res.status(404).json({ error: 'Supplier not found' });
    res.json({ message: 'Supplier deactivated', supplier });
  } catch (e: any) {
    console.error('[suppliers DELETE]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
