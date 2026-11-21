/**
 * Purchase Orders Route — ERP purchase order management
 * Mounted at /api/purchase-orders in index.ts
 *
 * GET    /api/purchase-orders                    — list POs (filters: status, supplierId, from, to)
 * GET    /api/purchase-orders/pending-deliveries — POs not yet fully received
 * GET    /api/purchase-orders/:id                — single PO with GRs and expenses
 * POST   /api/purchase-orders                    — create PO (requireAnyAdmin)
 * PUT    /api/purchase-orders/:id                — update status/details (requireAnyAdmin)
 * DELETE /api/purchase-orders/:id                — cancel PO if draft/sent (requireAnyAdmin)
 * POST   /api/purchase-orders/:id/receive        — goods inward, creates GoodsReceipt + StockMovements
 * POST   /api/purchase-orders/:id/expenses       — add expense (requireAnyAdmin)
 * GET    /api/purchase-orders/:id/expenses       — list expenses + landed cost summary
 */
import express from 'express';
import { PurchaseOrder } from '../models/purchaseOrder.js';
import { GoodsReceipt } from '../models/goodsReceipt.js';
import { PurchaseExpense } from '../models/purchaseExpense.js';
import { StockMovement } from '../models/stockMovement.js';
import { Supplier } from '../models/supplier.js';
import { Product } from '../db.js';
import { authenticate, requireAnyAdmin } from '../middleware/auth.js';

const router = express.Router();
router.use(authenticate);

/** Zero-padded date string YYYYMMDD */
function yyyymmdd(d = new Date()): string {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

// ── GET /pending-deliveries — MUST be before /:id ────────────────────────────
router.get('/pending-deliveries', requireAnyAdmin, async (_req, res) => {
  try {
    const pos = await PurchaseOrder.find({
      status: { $in: ['draft', 'sent', 'partially_received'] },
    })
      .populate('supplierId', 'name phoneNumber')
      .sort({ createdAt: -1 });
    res.json(pos);
  } catch (e: any) {
    console.error('[purchaseOrders/pending-deliveries]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET / — list purchase orders ──────────────────────────────────────────────
router.get('/', requireAnyAdmin, async (req, res) => {
  try {
    const filter: any = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.supplierId) filter.supplierId = req.query.supplierId;
    if (req.query.from || req.query.to) {
      filter.createdAt = {};
      if (req.query.from) filter.createdAt.$gte = new Date(String(req.query.from));
      if (req.query.to)   filter.createdAt.$lte = new Date(String(req.query.to));
    }
    const pos = await PurchaseOrder.find(filter)
      .populate('supplierId', 'name phoneNumber email')
      .sort({ createdAt: -1 });
    res.json(pos);
  } catch (e: any) {
    console.error('[purchaseOrders GET]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /:id — single PO with GRs and expenses ───────────────────────────────
router.get('/:id', requireAnyAdmin, async (req, res) => {
  try {
    const po = await PurchaseOrder.findById(req.params.id)
      .populate('supplierId', 'name phoneNumber email address gstin');
    if (!po) return res.status(404).json({ error: 'Purchase order not found' });

    const [goodsReceipts, expenses] = await Promise.all([
      GoodsReceipt.find({ purchaseOrderId: req.params.id }).sort({ receiptDate: -1 }),
      PurchaseExpense.find({ purchaseOrderId: req.params.id }).sort({ expenseDate: -1 }),
    ]);

    res.json({ ...po.toObject(), goodsReceipts, expenses });
  } catch (e: any) {
    console.error('[purchaseOrders GET/:id]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST / — create purchase order ────────────────────────────────────────────
router.post('/', requireAnyAdmin, async (req: any, res) => {
  try {
    const { supplierId, items, expectedDeliveryDate, notes } = req.body;
    if (!supplierId) return res.status(400).json({ error: 'supplierId is required' });
    if (!items?.length) return res.status(400).json({ error: 'items array is required' });

    const supplier = await Supplier.findById(supplierId);
    if (!supplier) return res.status(404).json({ error: 'Supplier not found' });

    // Auto-generate PO number: PO-YYYYMMDD-NNN
    const dateStr = yyyymmdd();
    const prefix = `PO-${dateStr}-`;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    const countToday = await PurchaseOrder.countDocuments({
      createdAt: { $gte: todayStart, $lte: todayEnd },
    });
    const poNumber = `${prefix}${String(countToday + 1).padStart(3, '0')}`;

    // Enrich items and calculate totalExpectedAmount
    const enrichedItems: any[] = [];
    let totalExpectedAmount = 0;

    for (const item of items) {
      if (!item.productId) return res.status(400).json({ error: 'Each item needs a productId' });
      if (!item.orderedQty || item.orderedQty <= 0)
        return res.status(400).json({ error: `Invalid orderedQty for item with productId ${item.productId}` });

      const product = await Product.findById(item.productId).select('name company');
      const productName = product?.name || item.productName || '';
      const brandName = product?.company || item.brandName || '';

      const rate = Number(item.rate) || 0;
      const orderedQty = Number(item.orderedQty);
      const gstPercent = Number(item.gstPercent) || 0;
      const discountPercent = Number(item.discountPercent) || 0;

      // totalAmount = rate * orderedQty * (1 + gstPercent/100) * (1 - discountPercent/100)
      const totalAmount = rate * orderedQty * (1 + gstPercent / 100) * (1 - discountPercent / 100);
      totalExpectedAmount += totalAmount;

      enrichedItems.push({
        productId: item.productId,
        productName,
        brandName,
        orderedQty,
        rate,
        discountPercent,
        gstPercent,
        totalAmount,
        batchNumber: item.batchNumber,
        expiryDate: item.expiryDate,
      });
    }

    const po = await PurchaseOrder.create({
      poNumber,
      supplierId,
      supplierName: supplier.name,
      items: enrichedItems,
      totalExpectedAmount,
      expectedDeliveryDate: expectedDeliveryDate ? new Date(expectedDeliveryDate) : undefined,
      notes,
      createdBy: req.user.id,
    });

    res.status(201).json(po);
  } catch (e: any) {
    console.error('[purchaseOrders POST]', e);
    if (e.code === 11000) return res.status(409).json({ error: 'PO number conflict, please retry' });
    res.status(500).json({ error: 'Server error' });
  }
});

// ── PUT /:id — update PO metadata ─────────────────────────────────────────────
router.put('/:id', requireAnyAdmin, async (req, res) => {
  try {
    const po = await PurchaseOrder.findById(req.params.id);
    if (!po) return res.status(404).json({ error: 'Purchase order not found' });
    if (po.status === 'cancelled') return res.status(400).json({ error: 'Cannot update a cancelled PO' });

    const allowedFields = ['status', 'expectedDeliveryDate', 'notes', 'supplierInvoiceNumber', 'paymentStatus'];
    // Block item updates if already received
    if (req.body.items && ['partially_received', 'received'].includes(po.status)) {
      return res.status(400).json({ error: 'Cannot update items on a PO that has already been received' });
    }

    const update: any = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) update[field] = req.body[field];
    }

    const updated = await PurchaseOrder.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true })
      .populate('supplierId', 'name phoneNumber email');
    res.json(updated);
  } catch (e: any) {
    console.error('[purchaseOrders PUT]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── DELETE /:id — cancel PO (draft/sent only) ─────────────────────────────────
router.delete('/:id', requireAnyAdmin, async (req, res) => {
  try {
    const po = await PurchaseOrder.findById(req.params.id);
    if (!po) return res.status(404).json({ error: 'Purchase order not found' });
    if (!['draft', 'sent'].includes(po.status))
      return res.status(400).json({ error: `Cannot cancel a PO with status '${po.status}'` });

    po.status = 'cancelled';
    await po.save();
    res.json({ message: 'Purchase order cancelled', po });
  } catch (e: any) {
    console.error('[purchaseOrders DELETE]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /:id/receive — goods inward ─────────────────────────────────────────
router.post('/:id/receive', requireAnyAdmin, async (req: any, res) => {
  try {
    const po = await PurchaseOrder.findById(req.params.id);
    if (!po) return res.status(404).json({ error: 'Purchase order not found' });
    if (po.status === 'cancelled') return res.status(400).json({ error: 'Cannot receive goods for a cancelled PO' });
    if (po.status === 'received') return res.status(400).json({ error: 'PO is already fully received' });

    const { items, notes } = req.body;
    if (!items?.length) return res.status(400).json({ error: 'items array is required' });

    // Auto-generate GR number: GR-YYYYMMDD-NNN
    const dateStr = yyyymmdd();
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
    const grCountToday = await GoodsReceipt.countDocuments({
      createdAt: { $gte: todayStart, $lte: todayEnd },
    });
    const receiptNumber = `GR-${dateStr}-${String(grCountToday + 1).padStart(3, '0')}`;

    const grItems: any[] = [];

    for (const incoming of items) {
      // Resolve PO item by purchaseItemIndex or productId
      let poItem: any = null;
      if (incoming.purchaseItemIndex !== undefined) {
        poItem = po.items[incoming.purchaseItemIndex];
      } else if (incoming.productId) {
        poItem = po.items.find((it: any) => String(it.productId) === String(incoming.productId));
      }

      if (!poItem) return res.status(400).json({ error: `PO item not found for: ${JSON.stringify(incoming)}` });

      const acceptedQty = Number(incoming.acceptedQty) || 0;
      const damagedQty = Number(incoming.damagedQty) || 0;
      const missingQty = Number(incoming.missingQty) || 0;

      // CRITICAL: only increase stock for acceptedQty
      if (acceptedQty > 0) {
        const product = await Product.findById(poItem.productId).select('name');
        grItems.push({
          purchaseItemId: poItem._id,
          productId: poItem.productId,
          productName: product?.name || poItem.productName || '',
          acceptedQty,
          damagedQty,
          missingQty,
          batchNumber: incoming.batchNumber || poItem.batchNumber,
          expiryDate: incoming.expiryDate || poItem.expiryDate,
        });

        // Update PO item receivedQty
        poItem.receivedQty = (poItem.receivedQty || 0) + acceptedQty;
        if (damagedQty) poItem.damagedQty = (poItem.damagedQty || 0) + damagedQty;
        if (missingQty) poItem.missingQty = (poItem.missingQty || 0) + missingQty;
      }
    }

    // Create GoodsReceipt
    const goodsReceipt = await GoodsReceipt.create({
      purchaseOrderId: po._id,
      receiptNumber,
      receivedBy: req.user.id,
      items: grItems,
      notes,
    });

    // Create StockMovement for each accepted item (IN)
    for (const grItem of grItems) {
      await StockMovement.create({
        tenantId: req.user.tenantId || 'default',
        productId: grItem.productId,
        quantity: grItem.acceptedQty,
        type: 'IN',
        referenceId: goodsReceipt._id,
        createdBy: req.user.id,
      });
    }

    // Update PO status: check if all items fully received
    const allReceived = po.items.every(
      (it: any) => it.receivedQty >= it.orderedQty
    );
    po.status = allReceived ? 'received' : 'partially_received';
    po.receivedDate = new Date();
    await po.save();

    const updatedPO = await PurchaseOrder.findById(po._id).populate('supplierId', 'name phoneNumber');
    res.status(201).json({ goodsReceipt, updatedPO });
  } catch (e: any) {
    console.error('[purchaseOrders receive]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /:id/expenses — add expense to PO ────────────────────────────────────
router.post('/:id/expenses', requireAnyAdmin, async (req: any, res) => {
  try {
    const po = await PurchaseOrder.findById(req.params.id);
    if (!po) return res.status(404).json({ error: 'Purchase order not found' });

    const { category, amount, expenseDate, notes, vehicleDetails, attachmentUrl } = req.body;
    if (!category) return res.status(400).json({ error: 'category is required' });
    if (amount == null || amount < 0) return res.status(400).json({ error: 'amount is required and must be >= 0' });

    const expense = await PurchaseExpense.create({
      purchaseOrderId: po._id,
      category,
      amount: Number(amount),
      expenseDate: expenseDate ? new Date(expenseDate) : new Date(),
      notes,
      vehicleDetails,
      attachmentUrl,
      createdBy: req.user.id,
    });

    res.status(201).json(expense);
  } catch (e: any) {
    console.error('[purchaseOrders expenses POST]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /:id/expenses — list expenses with landed cost summary ────────────────
router.get('/:id/expenses', requireAnyAdmin, async (req, res) => {
  try {
    const po = await PurchaseOrder.findById(req.params.id);
    if (!po) return res.status(404).json({ error: 'Purchase order not found' });

    const expenses = await PurchaseExpense.find({ purchaseOrderId: req.params.id }).sort({ expenseDate: -1 });

    const productSubtotal = po.items.reduce((sum: number, it: any) => sum + (it.totalAmount || 0), 0);
    const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
    const totalLandedCost = productSubtotal + totalExpenses;

    res.json({
      expenses,
      productSubtotal,
      totalExpenses,
      totalLandedCost,
    });
  } catch (e: any) {
    console.error('[purchaseOrders expenses GET]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
