/**
 * Shop Dashboard Route
 * Mounted at /api/shop/dashboard
 *
 * GET /api/shop/dashboard — summary KPIs, pending actions, low stock, financial metrics
 */
import express from 'express';
import { Invoice, Payment, Receipt, Product, Batch } from '../db.js';
import { PurchaseOrder } from '../models/purchaseOrder.js';
import { PurchaseExpense } from '../models/purchaseExpense.js';
import { ShopOrder } from '../models/order.js';
import { WhatsAppMessage } from '../models/whatsapp.js';
import { ShopFarmer } from '../models/shopFarmer.js';
import { authenticate, requireAnyAdmin } from '../middleware/auth.js';

const router = express.Router();
router.use(authenticate);

const getDashboardSummary = async (req: any, res: any) => {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const thirtyDaysAhead = new Date(Date.now() + 30 * 24 * 3600 * 1000);

    const [
      todayInvoices,
      todayPayments,
      allInvoices,
      allPayments,
      pendingCostingCount,
      pendingOrdersCount,
      pendingPOsCount,
      lowStockProducts,
      expiringBatches,
      recentBills,
      recentPOs,
      todayExpenses,
      failedWhatsAppCount,
    ] = await Promise.all([
      // Today's invoices
      Invoice.find({ createdAt: { $gte: todayStart, $lte: todayEnd }, status: { $ne: 'cancelled' } }),
      // Today's payments
      Payment.find({ createdAt: { $gte: todayStart, $lte: todayEnd } }),
      // All uncancelled invoices for outstanding calculation
      Invoice.find({ status: { $ne: 'cancelled' } }).select('totalAmount'),
      // All payments
      Payment.find().select('amount'),
      // Pending costing receipts
      Receipt.countDocuments({ purchaseCostPending: true }),
      // Pending farmer orders
      ShopOrder.countDocuments({ status: { $in: ['Pending', 'Confirmed', 'Partially Delivered'] } }),
      // Pending goods inward POs
      PurchaseOrder.countDocuments({ status: { $in: ['sent', 'partially_received'] } }),
      // Low stock products (< 10 units)
      Product.find({ isActive: true, stockQuantity: { $lt: 10 } })
        .select('name code category unit stockQuantity')
        .limit(10),
      // Batches expiring within 30 days
      Batch.find({ expiryDate: { $lte: thirtyDaysAhead, $gte: new Date() }, quantity: { $gt: 0 } })
        .populate('productId', 'name code unit')
        .sort({ expiryDate: 1 })
        .limit(10),
      // Recent 5 bills
      Invoice.find()
        .populate('items.productId', 'name unit')
        .sort({ createdAt: -1 })
        .limit(5),
      // Recent 5 POs
      PurchaseOrder.find()
        .populate('supplierId', 'name')
        .sort({ createdAt: -1 })
        .limit(5),
      // Today's purchase expenses
      PurchaseExpense.find({ expenseDate: { $gte: todayStart, $lte: todayEnd } }),
      // Failed WhatsApp notifications
      WhatsAppMessage.countDocuments({ status: 'failed' }),
    ]);

    const todaySales = todayInvoices.reduce((s, i) => s + (i.totalAmount || 0), 0);
    const todayCash = todayPayments.filter(p => p.method === 'Cash').reduce((s, p) => s + (p.amount || 0), 0);
    const todayUPI = todayPayments.filter(p => p.method === 'UPI').reduce((s, p) => s + (p.amount || 0), 0);
    const todayTotalCollected = todayPayments.reduce((s, p) => s + (p.amount || 0), 0);
    const todayCreditSales = Math.max(0, todaySales - (todayCash + todayUPI));

    // Outstanding total across all farmers
    const totalBilled = allInvoices.reduce((s, i) => s + (i.totalAmount || 0), 0);
    const totalPaid = allPayments.reduce((s, p) => s + (p.amount || 0), 0);
    const outstandingFarmerBalance = Math.max(0, Math.round((totalBilled - totalPaid) * 100) / 100);

    const totalTodayExpenses = todayExpenses.reduce((s, e) => s + (e.amount || 0), 0);

    res.json({
      today: {
        sales: todaySales,
        cash: todayCash,
        upi: todayUPI,
        credit: todayCreditSales,
        collected: todayTotalCollected,
        billCount: todayInvoices.length,
        expenses: totalTodayExpenses,
      },
      kpis: {
        outstandingFarmerBalance,
        pendingCostingCount,
        pendingOrdersCount,
        pendingGoodsInwardCount: pendingPOsCount,
        failedWhatsAppCount,
      },
      lowStock: lowStockProducts,
      expiringBatches,
      recentBills,
      recentPOs,
    });
  } catch (e: any) {
    console.error('[shop dashboard GET]', e);
    res.status(500).json({ error: 'Server error: ' + e.message });
  }
};

// GET /  — full dashboard summary
router.get('/', requireAnyAdmin, getDashboardSummary);
// GET /summary — alias used by some frontend builds
router.get('/summary', requireAnyAdmin, getDashboardSummary);

export default router;
