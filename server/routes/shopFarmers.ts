/**
 * Shop Farmers Route
 * Mounted at /api/shop/farmers
 *
 * GET    /api/shop/farmers             — list farmers (query: q)
 * GET    /api/shop/farmers/:id         — single farmer
 * POST   /api/shop/farmers             — create farmer
 * PUT    /api/shop/farmers/:id         — update farmer
 * GET    /api/shop/farmers/:id/ledger  — transaction ledger with running balance
 * POST   /api/shop/farmers/:id/payments — record credit collection
 */
import express from 'express';
import { ShopFarmer } from '../models/shopFarmer.js';
import { Invoice, Payment } from '../db.js';
import { authenticate, requireAnyAdmin } from '../middleware/auth.js';
import { logAudit } from '../utils/auditLog.js';

const router = express.Router();
router.use(authenticate);

// ── GET / — list shop farmers ─────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const filter: any = { isActive: true };
    if (req.query.q) {
      const regex = new RegExp(String(req.query.q).trim(), 'i');
      filter.$or = [{ name: regex }, { phoneNumber: regex }, { village: regex }];
    }
    const farmers = await ShopFarmer.find(filter)
      .sort({ name: 1 })
      .limit(Number(req.query.limit) || 200);
    res.json(farmers);
  } catch (e: any) {
    console.error('[shopFarmers GET]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /:id — single farmer ──────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const farmer = await ShopFarmer.findById(req.params.id);
    if (!farmer) return res.status(404).json({ error: 'Farmer not found' });
    res.json(farmer);
  } catch (e: any) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST / — register shop farmer ─────────────────────────────────────────────
router.post('/', async (req: any, res) => {
  try {
    const { name, phoneNumber, email, address, village, district, notes } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
    if (!phoneNumber?.trim()) return res.status(400).json({ error: 'Phone number is required' });

    const exists = await ShopFarmer.findOne({ phoneNumber: phoneNumber.trim() });
    if (exists) return res.status(409).json({ error: 'Farmer with this phone number already exists' });

    const farmer = await ShopFarmer.create({
      name: name.trim(),
      phoneNumber: phoneNumber.trim(),
      email: email?.trim(),
      address: address?.trim(),
      village: village?.trim(),
      district: district?.trim(),
      notes: notes?.trim(),
      createdBy: req.user.id,
    });

    await logAudit({
      tenantId: req.user.tenantId || 'shop',
      action: 'FARMER_CREATE',
      userId: req.user.id,
      collection: 'shopfarmers',
      documentId: farmer._id,
      before: null,
      after: farmer.toObject(),
    });

    res.status(201).json(farmer);
  } catch (e: any) {
    console.error('[shopFarmers POST]', e);
    res.status(500).json({ error: 'Server error: ' + e.message });
  }
});

// ── PUT /:id — update shop farmer ─────────────────────────────────────────────
router.put('/:id', requireAnyAdmin, async (req: any, res) => {
  try {
    const before = await ShopFarmer.findById(req.params.id);
    if (!before) return res.status(404).json({ error: 'Farmer not found' });

    const updates = { ...req.body };
    delete updates._id;
    delete updates.createdBy;

    const farmer = await ShopFarmer.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });

    await logAudit({
      tenantId: req.user.tenantId || 'shop',
      action: 'FARMER_UPDATE',
      userId: req.user.id,
      collection: 'shopfarmers',
      documentId: farmer!._id,
      before: before.toObject(),
      after: farmer!.toObject(),
    });

    res.json(farmer);
  } catch (e: any) {
    console.error('[shopFarmers PUT]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /:id/ledger — farmer ledger ───────────────────────────────────────────
router.get('/:id/ledger', async (req, res) => {
  try {
    const farmer = await ShopFarmer.findById(req.params.id);
    if (!farmer) return res.status(404).json({ error: 'Farmer not found' });

    const { from, to } = req.query as Record<string, string>;
    const dateFilter: any = {};
    if (from || to) {
      dateFilter.createdAt = {};
      if (from) dateFilter.createdAt.$gte = new Date(from);
      if (to) dateFilter.createdAt.$lte = new Date(to);
    }

    const invoices = await Invoice.find({
      farmerId: req.params.id,
      status: { $ne: 'cancelled' },
      ...dateFilter,
    }).sort({ createdAt: 1 });

    const invoiceIds = invoices.map(i => i._id);
    const payments = await Payment.find({
      invoiceId: { $in: invoiceIds },
    }).sort({ createdAt: 1 });

    const ledger: any[] = [];

    for (const inv of invoices) {
      ledger.push({
        type: 'Invoice',
        date: inv.createdAt,
        description: `Sale Bill #${inv._id.toString().slice(-6).toUpperCase()}`,
        debit: inv.totalAmount,
        credit: 0,
        invoiceId: inv._id,
        status: inv.status,
      });
    }

    for (const pmt of payments) {
      ledger.push({
        type: 'Payment',
        date: pmt.createdAt,
        description: `Payment Received (${pmt.method})`,
        debit: 0,
        credit: pmt.amount,
        paymentId: pmt._id,
        invoiceId: pmt.invoiceId,
      });
    }

    // Sort chronologically and calculate running balance
    ledger.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    let runningBalance = 0;
    for (const row of ledger) {
      runningBalance += row.debit - row.credit;
      row.balance = Math.round(runningBalance * 100) / 100;
    }

    const totalDebit = ledger.reduce((s, r) => s + r.debit, 0);
    const totalCredit = ledger.reduce((s, r) => s + r.credit, 0);
    const outstanding = Math.round((totalDebit - totalCredit) * 100) / 100;

    res.json({
      farmerId: farmer._id,
      farmerName: farmer.name,
      phoneNumber: farmer.phoneNumber,
      ledger,
      totalDebit,
      totalCredit,
      outstanding,
    });
  } catch (e: any) {
    console.error('[shopFarmers ledger]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /:id/payments — record credit collection (recovery) ─────────────────
router.post('/:id/payments', async (req: any, res) => {
  try {
    const { amount, method, notes, referenceInvoiceId } = req.body;
    if (!amount || Number(amount) <= 0) return res.status(400).json({ error: 'Positive amount is required' });
    if (!method) return res.status(400).json({ error: 'Payment method is required' });

    const farmer = await ShopFarmer.findById(req.params.id);
    if (!farmer) return res.status(404).json({ error: 'Farmer not found' });

    let invoice: any = null;
    if (referenceInvoiceId) {
      invoice = await Invoice.findById(referenceInvoiceId);
    }

    const payment = await Payment.create({
      invoiceId: invoice?._id || new (await import('mongoose')).default.Types.ObjectId(),
      amount: Number(amount),
      method,
      details: { notes: notes || 'Credit collection', farmerId: req.params.id },
      createdBy: req.user.id,
    });

    // Update farmer outstanding balance snapshot
    farmer.totalCredit = Math.max(0, (farmer.totalCredit || 0) - Number(amount));
    await farmer.save();

    await logAudit({
      tenantId: req.user.tenantId || 'shop',
      action: 'CREDIT_COLLECTION',
      userId: req.user.id,
      collection: 'payments',
      documentId: payment._id,
      before: null,
      after: { farmerId: farmer._id, amount: Number(amount), method },
    });

    res.status(201).json({ success: true, payment, updatedFarmerCredit: farmer.totalCredit });
  } catch (e: any) {
    console.error('[shopFarmers payments POST]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
