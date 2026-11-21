/**
 * Shop Reports Route
 * Mounted at /api/shop/reports
 *
 * GET /api/shop/reports/sales     — sales breakdown
 * GET /api/shop/reports/purchases — purchase summary & landed costs
 * GET /api/shop/reports/stock     — stock valuation & inventory
 * GET /api/shop/reports/expenses  — transport & labour expense analysis
 * GET /api/shop/reports/credit    — farmer credit & aging balances
 * GET /api/shop/reports/profit    — estimated profit & margins (financial roles only)
 */
import express from 'express';
import { Invoice, Payment, Product, Batch } from '../db.js';
import { PurchaseOrder } from '../models/purchaseOrder.js';
import { PurchaseExpense } from '../models/purchaseExpense.js';
import { ShopFarmer } from '../models/shopFarmer.js';
import { authenticate, requireAnyAdmin } from '../middleware/auth.js';
import { isFinancialAuthorized } from '../utils/serializer.js';

const router = express.Router();
router.use(authenticate);

// ── GET /sales — sales reports ────────────────────────────────────────────────
router.get('/sales', async (req, res) => {
  try {
    const fromStr = (req.query.from as string) || new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const toStr = (req.query.to as string) || new Date().toISOString().slice(0, 10);

    const from = new Date(`${fromStr}T00:00:00.000Z`);
    const to = new Date(`${toStr}T23:59:59.999Z`);

    const invoices = await Invoice.find({
      createdAt: { $gte: from, $lte: to },
      status: { $ne: 'cancelled' },
    }).populate('items.productId', 'name category');

    const totalSales = invoices.reduce((s, i) => s + (i.totalAmount || 0), 0);
    const categoryTotals: Record<string, number> = {};

    for (const inv of invoices) {
      for (const it of inv.items) {
        const cat = (it.productId as any)?.category || 'Other';
        categoryTotals[cat] = (categoryTotals[cat] || 0) + (it.total || 0);
      }
    }

    res.json({
      from: fromStr,
      to: toStr,
      totalBills: invoices.length,
      totalSales,
      categoryBreakdown: categoryTotals,
    });
  } catch (e: any) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /purchases — purchase cost & volume ───────────────────────────────────
router.get('/purchases', requireAnyAdmin, async (req, res) => {
  try {
    const fromStr = (req.query.from as string) || new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const toStr = (req.query.to as string) || new Date().toISOString().slice(0, 10);

    const from = new Date(`${fromStr}T00:00:00.000Z`);
    const to = new Date(`${toStr}T23:59:59.999Z`);

    const pos = await PurchaseOrder.find({
      createdAt: { $gte: from, $lte: to },
      status: { $ne: 'cancelled' },
    }).populate('supplierId', 'name');

    const totalOrderedAmount = pos.reduce((s, po) => s + (po.totalExpectedAmount || 0), 0);
    const totalReceivedAmount = pos.reduce((s, po) => s + (po.totalReceivedAmount || 0), 0);

    res.json({
      from: fromStr,
      to: toStr,
      totalPOs: pos.length,
      totalOrderedAmount,
      totalReceivedAmount,
      pos,
    });
  } catch (e: any) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /stock — stock valuation report ────────────────────────────────────────
router.get('/stock', async (req, res) => {
  try {
    const products = await Product.find({ isActive: true })
      .select('name code category unit packSize stockQuantity mrp approvedSellingRate purchaseRate');

    const isFinancial = isFinancialAuthorized(req.user?.role);

    let totalValuationSelling = 0;
    let totalValuationPurchase = 0;

    const inventory = products.map(p => {
      const stock = p.stockQuantity || 0;
      const sellingVal = Math.round(stock * (p.approvedSellingRate || 0) * 100) / 100;
      totalValuationSelling += sellingVal;

      let purchaseVal = 0;
      if (isFinancial && p.purchaseRate) {
        purchaseVal = Math.round(stock * p.purchaseRate * 100) / 100;
        totalValuationPurchase += purchaseVal;
      }

      return {
        _id: p._id,
        name: p.name,
        code: p.code,
        category: p.category,
        unit: p.unit,
        stockQuantity: stock,
        approvedSellingRate: p.approvedSellingRate,
        sellingValuation: sellingVal,
        ...(isFinancial ? { purchaseRate: p.purchaseRate, purchaseValuation: purchaseVal } : {}),
      };
    });

    res.json({
      totalProducts: products.length,
      totalValuationSelling,
      ...(isFinancial ? { totalValuationPurchase } : {}),
      inventory,
    });
  } catch (e: any) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /expenses — transport & labour expenses report ─────────────────────────
router.get('/expenses', requireAnyAdmin, async (req, res) => {
  try {
    const fromStr = (req.query.from as string) || new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const toStr = (req.query.to as string) || new Date().toISOString().slice(0, 10);

    const from = new Date(`${fromStr}T00:00:00.000Z`);
    const to = new Date(`${toStr}T23:59:59.999Z`);

    const expenses = await PurchaseExpense.find({
      expenseDate: { $gte: from, $lte: to },
    }).populate('purchaseOrderId', 'poNumber supplierName');

    const byCategory: Record<string, { total: number; count: number }> = {};
    let totalAmount = 0;

    for (const exp of expenses) {
      const cat = exp.category || 'other';
      if (!byCategory[cat]) byCategory[cat] = { total: 0, count: 0 };
      byCategory[cat].total += exp.amount;
      byCategory[cat].count += 1;
      totalAmount += exp.amount;
    }

    res.json({
      from: fromStr,
      to: toStr,
      totalExpenses: totalAmount,
      byCategory,
      expenses,
    });
  } catch (e: any) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /credit — farmer credit report ─────────────────────────────────────────
router.get('/credit', async (req, res) => {
  try {
    const farmers = await ShopFarmer.find({ isActive: true, totalCredit: { $gt: 0 } })
      .select('name phoneNumber village totalCredit updatedAt')
      .sort({ totalCredit: -1 });

    const totalOutstanding = farmers.reduce((s, f) => s + (f.totalCredit || 0), 0);

    res.json({
      totalFarmersWithCredit: farmers.length,
      totalOutstanding,
      farmers,
    });
  } catch (e: any) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /profit — profit analysis (financial roles only) ──────────────────────
router.get('/profit', requireAnyAdmin, async (req, res) => {
  try {
    if (!isFinancialAuthorized(req.user?.role)) {
      return res.status(403).json({ error: 'Access denied: confidential financial data.' });
    }

    const fromStr = (req.query.from as string) || new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const toStr = (req.query.to as string) || new Date().toISOString().slice(0, 10);

    const from = new Date(`${fromStr}T00:00:00.000Z`);
    const to = new Date(`${toStr}T23:59:59.999Z`);

    const invoices = await Invoice.find({
      createdAt: { $gte: from, $lte: to },
      status: { $ne: 'cancelled' },
    }).populate('items.productId', 'name purchaseRate approvedSellingRate');

    let totalRevenue = 0;
    let totalCostOfGoods = 0;

    for (const inv of invoices) {
      for (const it of inv.items) {
        const prod = it.productId as any;
        const qty = it.quantity || 0;
        const rev = it.total || 0;
        const cost = qty * (prod?.purchaseRate || 0);

        totalRevenue += rev;
        totalCostOfGoods += cost;
      }
    }

    const grossProfit = Math.round((totalRevenue - totalCostOfGoods) * 100) / 100;
    const grossMarginPercent = totalRevenue > 0 ? Math.round((grossProfit / totalRevenue) * 10000) / 100 : 0;

    res.json({
      from: fromStr,
      to: toStr,
      totalRevenue,
      totalCostOfGoods,
      grossProfit,
      grossMarginPercent,
    });
  } catch (e: any) {
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
