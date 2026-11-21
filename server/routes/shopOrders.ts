/**
 * Shop Orders Route — Farmer Orders & Partial Deliveries
 * Mounted at /api/shop/orders
 *
 * GET  /api/shop/orders                    — list orders (status, farmerId, date)
 * GET  /api/shop/orders/calendar           — orders grouped by delivery date
 * GET  /api/shop/orders/:id                — single order detail
 * POST /api/shop/orders                    — create new order
 * PUT  /api/shop/orders/:id/status         — update order status
 * POST /api/shop/orders/:id/deliveries     — record partial/full delivery
 * POST /api/shop/orders/:id/payments       — record advance or balance payment
 */
import express from 'express';
import { ShopOrder } from '../models/order.js';
import { Product } from '../db.js';
import { authenticate, requireAnyAdmin } from '../middleware/auth.js';
import { logAudit } from '../utils/auditLog.js';

const router = express.Router();
router.use(authenticate);

// ── Zero-padded date string YYYYMMDD ──────────────────────────────────────────
function yyyymmdd(d = new Date()): string {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

// ── GET /calendar — orders by delivery date ───────────────────────────────────
router.get('/calendar', async (req, res) => {
  try {
    const orders = await ShopOrder.find({
      status: { $in: ['Pending', 'Confirmed', 'Partially Delivered'] },
    }).sort({ expectedDeliveryDate: 1 });

    const grouped: Record<string, any[]> = {};
    for (const ord of orders) {
      const dateKey = ord.expectedDeliveryDate
        ? ord.expectedDeliveryDate.toISOString().slice(0, 10)
        : 'Unscheduled';
      if (!grouped[dateKey]) grouped[dateKey] = [];
      grouped[dateKey].push(ord);
    }

    res.json(grouped);
  } catch (e: any) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET / — list orders ───────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const filter: any = {};
    if (req.query.status)   filter.status = req.query.status;
    if (req.query.farmerId) filter.farmerId = req.query.farmerId;
    if (req.query.from || req.query.to) {
      filter.orderDate = {};
      if (req.query.from) filter.orderDate.$gte = new Date(req.query.from as string);
      if (req.query.to)   filter.orderDate.$lte = new Date(req.query.to as string);
    }

    const orders = await ShopOrder.find(filter).sort({ orderDate: -1 });
    res.json(orders);
  } catch (e: any) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /:id — single order ───────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const order = await ShopOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json(order);
  } catch (e: any) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST / — create farmer order ──────────────────────────────────────────────
router.post('/', async (req: any, res) => {
  try {
    const { farmerId, farmerName, farmerPhone, items, expectedDeliveryDate, advancePaid, notes } = req.body;
    if (!farmerId || !farmerName || !items?.length) {
      return res.status(400).json({ error: 'farmerId, farmerName and items are required' });
    }

    const dateStr = yyyymmdd();
    const count = await ShopOrder.countDocuments();
    const orderId = `ORD-${dateStr}-${String(count + 1).padStart(3, '0')}`;

    let totalAmount = 0;
    const resolvedItems: any[] = [];

    for (const it of items) {
      const product = await Product.findById(it.productId).select('name unit approvedSellingRate');
      const rate = it.rate != null ? Number(it.rate) : (product?.approvedSellingRate || 0);
      const qty = Number(it.orderedQuantity);
      const lineTotal = Math.round(rate * qty * 100) / 100;
      totalAmount += lineTotal;

      resolvedItems.push({
        productId: it.productId,
        productName: product?.name || it.productName,
        unit: product?.unit || it.unit || 'kg',
        orderedQuantity: qty,
        deliveredQuantity: 0,
        remainingQuantity: qty,
        rate,
        total: lineTotal,
      });
    }

    const advance = Number(advancePaid) || 0;
    const paymentBalance = totalAmount - advance;

    const order = await ShopOrder.create({
      orderId,
      farmerId,
      farmerName,
      farmerPhone,
      expectedDeliveryDate: expectedDeliveryDate ? new Date(expectedDeliveryDate) : undefined,
      items: resolvedItems,
      totalAmount,
      advancePaid: advance,
      paymentBalance,
      payments: advance > 0 ? [{ amount: advance, method: 'Cash', createdBy: req.user.id }] : [],
      notes,
      createdBy: req.user.id,
    });

    await logAudit({
      tenantId: req.user.tenantId || 'shop',
      action: 'ORDER_CREATE',
      userId: req.user.id,
      collection: 'shoporders',
      documentId: order._id,
      before: null,
      after: order.toObject(),
    });

    res.status(201).json(order);
  } catch (e: any) {
    console.error('[shopOrders POST]', e);
    res.status(500).json({ error: 'Server error: ' + e.message });
  }
});

// ── PUT /:id/status — update status ───────────────────────────────────────────
router.put('/:id/status', requireAnyAdmin, async (req: any, res) => {
  try {
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: 'Status is required' });

    const order = await ShopOrder.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json(order);
  } catch (e: any) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /:id/deliveries — record partial/full delivery ────────────────────────
router.post('/:id/deliveries', async (req: any, res) => {
  try {
    const order = await ShopOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const { items, notes } = req.body; // array of { productId, quantity }
    if (!items?.length) return res.status(400).json({ error: 'Delivered items array required' });

    for (const delItem of items) {
      const line = order.items.find(i => String(i.productId) === String(delItem.productId));
      if (line) {
        line.deliveredQuantity = (line.deliveredQuantity || 0) + Number(delItem.quantity);
        line.remainingQuantity = Math.max(0, line.orderedQuantity - line.deliveredQuantity);
      }
    }

    // Determine overall status
    const allDelivered = order.items.every(i => (i.remainingQuantity || 0) <= 0);
    order.status = allDelivered ? 'Delivered' : 'Partially Delivered';

    order.deliveries.push({
      deliveryNumber: `DEL-${Date.now().toString().slice(-6)}`,
      deliveryDate: new Date(),
      deliveredBy: req.user.name || req.user.id,
      items,
      notes,
    } as any);

    await order.save();
    res.json(order);
  } catch (e: any) {
    console.error('[shopOrders deliveries POST]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /:id/payments — record payment on order ──────────────────────────────
router.post('/:id/payments', async (req: any, res) => {
  try {
    const order = await ShopOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const { amount, method, details } = req.body;
    if (!amount || Number(amount) <= 0) return res.status(400).json({ error: 'Positive amount required' });

    const numAmount = Number(amount);
    order.payments.push({
      amount: numAmount,
      method: method || 'Cash',
      date: new Date(),
      details: details || {},
      createdBy: req.user.id,
    } as any);

    order.advancePaid = (order.advancePaid || 0) + numAmount;
    order.paymentBalance = Math.max(0, order.totalAmount - order.advancePaid);
    await order.save();

    res.json(order);
  } catch (e: any) {
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
