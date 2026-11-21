/**
 * Sales & Billing Route
 * Mounted at /api/shop/sales
 *
 * POST /api/shop/sales                    — create bill with immutable item snapshots & transactional stock deduction
 * GET  /api/shop/sales                    — list bills with filters (date range, farmerId, status)
 * GET  /api/shop/sales/calendar           — daily/monthly sales calendar breakdown
 * GET  /api/shop/sales/daily/:date        — detailed breakdown for a specific date
 * GET  /api/shop/sales/:id                — single bill with items & payment breakdown
 * POST /api/shop/sales/:id/payments       — add payment to bill
 * POST /api/shop/sales/:id/returns        — sales return & stock reinstatement
 * POST /api/shop/sales/:id/cancel         — cancel/reverse bill & restore stock
 */
import express from 'express';
import mongoose from 'mongoose';
import { Invoice, Payment, Product, LedgerEntry } from '../db.js';
import { StockMovement } from '../models/stockMovement.js';
import { SaleReturn } from '../models/saleReturn.js';
import { ShopFarmer } from '../models/shopFarmer.js';
import { authenticate, requireAnyAdmin } from '../middleware/auth.js';
import { logAudit } from '../utils/auditLog.js';

const router = express.Router();
router.use(authenticate);

// ── GET /calendar — daily sales calendar breakdown ───────────────────────────
router.get('/calendar', async (req, res) => {
  try {
    const fromStr = (req.query.from as string) || new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const toStr = (req.query.to as string) || new Date().toISOString().slice(0, 10);

    const fromDate = new Date(`${fromStr}T00:00:00.000Z`);
    const toDate = new Date(`${toStr}T23:59:59.999Z`);

    const invoices = await Invoice.find({
      createdAt: { $gte: fromDate, $lte: toDate },
      status: { $ne: 'cancelled' },
    });

    const invoiceIds = invoices.map(i => i._id);
    const payments = await Payment.find({
      createdAt: { $gte: fromDate, $lte: toDate },
    });

    const returns = await SaleReturn.find({
      createdAt: { $gte: fromDate, $lte: toDate },
    });

    // Group by YYYY-MM-DD
    const calendar: Record<string, {
      date: string;
      cashSales: number;
      upiSales: number;
      creditSales: number;
      totalSales: number;
      collectionReceived: number;
      creditRecovered: number;
      billCount: number;
      returns: number;
      netSales: number;
    }> = {};

    for (const inv of invoices) {
      const day = inv.createdAt.toISOString().slice(0, 10);
      if (!calendar[day]) {
        calendar[day] = {
          date: day,
          cashSales: 0,
          upiSales: 0,
          creditSales: 0,
          totalSales: 0,
          collectionReceived: 0,
          creditRecovered: 0,
          billCount: 0,
          returns: 0,
          netSales: 0,
        };
      }
      calendar[day].totalSales += inv.totalAmount || 0;
      calendar[day].billCount += 1;
    }

    for (const pmt of payments) {
      const day = pmt.createdAt.toISOString().slice(0, 10);
      if (!calendar[day]) {
        calendar[day] = {
          date: day,
          cashSales: 0,
          upiSales: 0,
          creditSales: 0,
          totalSales: 0,
          collectionReceived: 0,
          creditRecovered: 0,
          billCount: 0,
          returns: 0,
          netSales: 0,
        };
      }

      if (pmt.method === 'Cash') calendar[day].cashSales += pmt.amount || 0;
      else if (pmt.method === 'UPI') calendar[day].upiSales += pmt.amount || 0;

      calendar[day].collectionReceived += pmt.amount || 0;

      // If payment is for an invoice created before this day, it's credit recovery
      const isRecovery = !invoices.some(i => i._id.equals(pmt.invoiceId) && i.createdAt.toISOString().slice(0, 10) === day);
      if (isRecovery) {
        calendar[day].creditRecovered += pmt.amount || 0;
      }
    }

    for (const ret of returns) {
      const day = ret.createdAt.toISOString().slice(0, 10);
      if (calendar[day]) {
        calendar[day].returns += ret.totalRefund || 0;
      }
    }

    // Compute credit sales = totalSales - (collectionReceived on that same day for that day's sales)
    const result = Object.values(calendar).map(c => {
      c.creditSales = Math.max(0, c.totalSales - (c.cashSales + c.upiSales));
      c.netSales = Math.round((c.totalSales - c.returns) * 100) / 100;
      return c;
    }).sort((a, b) => b.date.localeCompare(a.date));

    res.json(result);
  } catch (e: any) {
    console.error('[sales/calendar]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /daily/:date — detailed breakdown for a specific date ─────────────────
router.get('/daily/:date', async (req, res) => {
  try {
    const { date } = req.params;
    const start = new Date(`${date}T00:00:00.000Z`);
    const end = new Date(`${date}T23:59:59.999Z`);

    const invoices = await Invoice.find({
      createdAt: { $gte: start, $lte: end },
    })
      .populate('items.productId', 'name code unit category company')
      .sort({ createdAt: -1 });

    const invoiceIds = invoices.map(i => i._id);
    const payments = await Payment.find({
      $or: [
        { invoiceId: { $in: invoiceIds } },
        { createdAt: { $gte: start, $lte: end } }
      ]
    });

    const returns = await SaleReturn.find({
      createdAt: { $gte: start, $lte: end },
    });

    const totalSales = invoices.filter(i => i.status !== 'cancelled').reduce((s, i) => s + (i.totalAmount || 0), 0);
    const totalCollected = payments.reduce((s, p) => s + (p.amount || 0), 0);
    const totalReturns = returns.reduce((s, r) => s + (r.totalRefund || 0), 0);

    res.json({
      date,
      totalSales,
      totalCollected,
      totalReturns,
      netSales: totalSales - totalReturns,
      invoices,
      payments,
      returns,
    });
  } catch (e: any) {
    console.error('[sales/daily/:date]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET / — list bills ────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const filter: any = {};
    if (req.query.farmerId) filter.farmerId = req.query.farmerId;
    if (req.query.status)   filter.status = req.query.status;
    if (req.query.from || req.query.to) {
      filter.createdAt = {};
      if (req.query.from) filter.createdAt.$gte = new Date(req.query.from as string);
      if (req.query.to)   filter.createdAt.$lte = new Date(req.query.to as string);
    }

    const invoices = await Invoice.find(filter)
      .populate('items.productId', 'name code unit category company')
      .sort({ createdAt: -1 });

    res.json(invoices);
  } catch (e: any) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /:id — single bill ────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id)
      .populate('items.productId', 'name code unit category company');
    if (!invoice) return res.status(404).json({ error: 'Bill not found' });

    const payments = await Payment.find({ invoiceId: req.params.id }).sort({ createdAt: 1 });
    const returns = await SaleReturn.find({ invoiceId: req.params.id });

    res.json({ ...invoice.toObject(), payments, returns });
  } catch (e: any) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST / — create bill with immutable snapshots & transactional stock deduction ─
router.post('/', async (req: any, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { farmerId, pondId, items, payment, idempotencyKey } = req.body;
    if (!farmerId || !items?.length) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: 'farmerId and items are required' });
    }

    if (idempotencyKey) {
      const existing = await Invoice.findOne({ idempotencyKey }).session(session);
      if (existing) {
        await session.abortTransaction();
        session.endSession();
        return res.status(200).json({ ...existing.toObject(), _idempotent: true });
      }
    }

    let totalAmount = 0;
    const resolvedItems: any[] = [];
    const stockMovementsToCreate: any[] = [];

    for (const clientItem of items) {
      if (!clientItem.productId || !clientItem.quantity || clientItem.quantity <= 0) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ error: 'Each item needs a valid productId and quantity' });
      }

      const product = await Product.findById(clientItem.productId).session(session);
      if (!product || !product.isActive) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ error: `Product inactive or not found: ${clientItem.productId}` });
      }

      const rate = product.approvedSellingRate;
      if (!rate || rate <= 0) {
        await session.abortTransaction();
        session.endSession();
        return res.status(422).json({ error: `Product "${product.name}" has no approved selling rate.` });
      }

      const discountPct = Math.min(clientItem.discountPercent || 0, product.sellingDiscountPercent || 0);
      const lineTotal = Math.round(rate * (1 - discountPct / 100) * clientItem.quantity * 100) / 100;
      totalAmount += lineTotal;

      resolvedItems.push({
        productId: product._id,
        batchId: clientItem.batchId,
        quantity: clientItem.quantity,
        unitPrice: rate,
        discountPercent: discountPct,
        total: lineTotal,
      });

      // Deduct product stockQuantity on-hand
      product.stockQuantity = Math.max(0, (product.stockQuantity || 0) - clientItem.quantity);
      await product.save({ session });

      stockMovementsToCreate.push({
        tenantId: req.user.tenantId || 'shop',
        productId: product._id,
        batchId: clientItem.batchId,
        quantity: -clientItem.quantity, // OUT
        type: 'OUT',
        createdBy: req.user.id,
      });
    }

    const paidAmount = payment?.amount ? Number(payment.amount) : 0;
    const status = paidAmount >= totalAmount ? 'paid' : (paidAmount > 0 ? 'finalized' : 'draft');

    const [invoice] = await Invoice.create(
      [
        {
          farmerId,
          pondId,
          items: resolvedItems,
          totalAmount,
          status,
          idempotencyKey,
          createdBy: req.user.id,
        },
      ],
      { session }
    );

    // Create stock movements
    for (const sm of stockMovementsToCreate) {
      sm.referenceId = invoice._id;
      await StockMovement.create([sm], { session });
    }

    // Record payment if provided
    if (paidAmount > 0) {
      await Payment.create(
        [
          {
            invoiceId: invoice._id,
            amount: paidAmount,
            method: payment.method || 'Cash',
            details: payment.details || {},
            createdBy: req.user.id,
          },
        ],
        { session }
      );
    }

    // Update farmer credit if credit sale
    const creditAmount = totalAmount - paidAmount;
    if (creditAmount > 0) {
      await ShopFarmer.findByIdAndUpdate(
        farmerId,
        { $inc: { totalCredit: creditAmount } },
        { session }
      );
    }

    await session.commitTransaction();
    session.endSession();

    await logAudit({
      tenantId: req.user.tenantId || 'shop',
      action: 'BILL_CREATE',
      userId: req.user.id,
      collection: 'invoices',
      documentId: invoice._id,
      before: null,
      after: invoice.toObject(),
    });

    const populated = await Invoice.findById(invoice._id).populate('items.productId', 'name code unit');
    res.status(201).json(populated);
  } catch (e: any) {
    await session.abortTransaction();
    session.endSession();
    console.error('[sales POST]', e);
    res.status(500).json({ error: 'Server error: ' + e.message });
  }
});

// ── POST /:id/returns — sales return with stock reversal ───────────────────────
router.post('/:id/returns', requireAnyAdmin, async (req: any, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const invoice = await Invoice.findById(req.params.id).session(session);
    if (!invoice) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ error: 'Bill not found' });
    }

    const { items, refundMethod, reason } = req.body;
    if (!items?.length) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: 'Return items array required' });
    }

    let totalRefund = 0;
    const returnItems: any[] = [];

    for (const item of items) {
      const invItem = invoice.items.find(i => String(i.productId) === String(item.productId));
      if (!invItem) continue;

      const refundQty = Number(item.quantity);
      const refundAmt = Math.round(invItem.unitPrice * (1 - (invItem.discountPercent || 0) / 100) * refundQty * 100) / 100;
      totalRefund += refundAmt;

      returnItems.push({
        productId: invItem.productId,
        productName: (invItem as any).productName || 'Product',
        quantity: refundQty,
        rate: invItem.unitPrice,
        refundAmount: refundAmt,
        condition: item.condition || 'resalable',
      });

      // Reinstate stock if resalable
      if (item.condition !== 'damaged') {
        await Product.findByIdAndUpdate(invItem.productId, { $inc: { stockQuantity: refundQty } }, { session });
        await StockMovement.create(
          [
            {
              tenantId: req.user.tenantId || 'shop',
              productId: invItem.productId,
              quantity: refundQty, // IN (positive)
              type: 'IN',
              referenceId: invoice._id,
              createdBy: req.user.id,
            },
          ],
          { session }
        );
      }
    }

    const year = new Date().getFullYear();
    const count = await SaleReturn.countDocuments().session(session);
    const returnNumber = `RET-${year}-${String(count + 1).padStart(3, '0')}`;

    const [saleReturn] = await SaleReturn.create(
      [
        {
          invoiceId: invoice._id,
          farmerId: invoice.farmerId,
          returnNumber,
          items: returnItems,
          totalRefund,
          refundMethod: refundMethod || 'Credit Adjustment',
          reason,
          createdBy: req.user.id,
        },
      ],
      { session }
    );

    // If refund is credit adjustment, deduct from farmer credit
    if (refundMethod === 'Credit Adjustment') {
      await ShopFarmer.findByIdAndUpdate(
        invoice.farmerId,
        { $inc: { totalCredit: -totalRefund } },
        { session }
      );
    }

    await session.commitTransaction();
    session.endSession();

    await logAudit({
      tenantId: req.user.tenantId || 'shop',
      action: 'BILL_RETURN',
      userId: req.user.id,
      collection: 'salereturns',
      documentId: saleReturn._id,
      before: null,
      after: saleReturn.toObject(),
    });

    res.status(201).json(saleReturn);
  } catch (e: any) {
    await session.abortTransaction();
    session.endSession();
    console.error('[sales returns POST]', e);
    res.status(500).json({ error: 'Server error: ' + e.message });
  }
});

// ── POST /:id/cancel — cancel bill with full stock restoration ────────────────
router.post('/:id/cancel', requireAnyAdmin, async (req: any, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const invoice = await Invoice.findById(req.params.id).session(session);
    if (!invoice) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ error: 'Bill not found' });
    }

    if (invoice.status === 'cancelled') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: 'Bill is already cancelled' });
    }

    const before = invoice.toObject();
    invoice.status = 'cancelled';
    await invoice.save({ session });

    // Restore stock for all items
    for (const item of invoice.items) {
      await Product.findByIdAndUpdate(item.productId, { $inc: { stockQuantity: item.quantity } }, { session });
      await StockMovement.create(
        [
          {
            tenantId: req.user.tenantId || 'shop',
            productId: item.productId,
            quantity: item.quantity, // IN (positive restore)
            type: 'IN',
            referenceId: invoice._id,
            createdBy: req.user.id,
          },
        ],
        { session }
      );
    }

    await session.commitTransaction();
    session.endSession();

    await logAudit({
      tenantId: req.user.tenantId || 'shop',
      action: 'BILL_CANCEL',
      userId: req.user.id,
      collection: 'invoices',
      documentId: invoice._id,
      before,
      after: invoice.toObject(),
    });

    res.json({ message: 'Bill cancelled and stock restored successfully', invoice });
  } catch (e: any) {
    await session.abortTransaction();
    session.endSession();
    console.error('[sales cancel POST]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
