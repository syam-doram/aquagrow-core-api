/**
 * Products Route
 * Mounted at /api/products and /api/shop/products
 *
 * GET  /api/products                        — list all active products (redacted for non-financial roles)
 * GET  /api/products/inventory/stock        — current stock of all products
 * GET  /api/products/inventory/expiry       — upcoming batch expirations
 * GET  /api/products/:id                    — single product detail (redacted for staff)
 * POST /api/products                        — create product (admin)
 * PUT  /api/products/:id                    — update product (admin)
 * PUT  /api/products/:id/selling-price      — owner sets approved selling rate
 * GET  /api/products/:id/batches            — list batches for product
 * POST /api/products/:id/batches            — create batch for product
 */
import express from 'express';
import { Product, Batch } from '../db.js';
import { authenticate, requireAnyAdmin } from '../middleware/auth.js';
import {
  serializeProduct,
  serializeProducts,
  serializeBatch,
  serializeBatches,
  isFinancialAuthorized,
} from '../utils/serializer.js';
import { logAudit } from '../utils/auditLog.js';

const router = express.Router();
router.use(authenticate);

// ── GET /inventory/stock — MUST be before /:id ────────────────────────────────
router.get('/inventory/stock', async (req, res) => {
  try {
    const products = await Product.find({ isActive: true })
      .select('name code category unit packSize stockQuantity mrp approvedSellingRate purchaseRate')
      .sort({ name: 1 });

    const serialized = serializeProducts(products, req.user?.role);
    res.json(serialized);
  } catch (e: any) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /inventory/expiry — MUST be before /:id ───────────────────────────────
router.get('/inventory/expiry', async (req, res) => {
  try {
    const days = Number(req.query.days) || 60;
    const cutoff = new Date(Date.now() + days * 24 * 3600 * 1000);

    const batches = await Batch.find({
      expiryDate: { $lte: cutoff, $gte: new Date() },
      quantity: { $gt: 0 },
    })
      .populate('productId', 'name code unit')
      .sort({ expiryDate: 1 });

    const serialized = serializeBatches(batches, req.user?.role);
    res.json(serialized);
  } catch (e: any) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET / — list products ─────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const filter: any = {};
    if (req.query.category) filter.category = req.query.category;
    if (req.query.isActive !== 'false') filter.isActive = true;

    if (req.query.q) {
      const regex = new RegExp(String(req.query.q).trim(), 'i');
      filter.$or = [{ name: regex }, { code: regex }, { company: regex }, { brand: regex }];
    }

    const products = await Product.find(filter)
      .select('-__v')
      .sort({ category: 1, name: 1 });

    const serialized = serializeProducts(products, req.user?.role);
    res.json(serialized);
  } catch (e: any) {
    console.error('[products GET]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /:id — single product ──────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id).select('-__v');
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const serialized = serializeProduct(product, req.user?.role);
    res.json(serialized);
  } catch (e: any) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /:id/batches — list batches for a product ──────────────────────────────
router.get('/:id/batches', async (req, res) => {
  try {
    const batches = await Batch.find({ productId: req.params.id })
      .populate('supplierId', 'name')
      .sort({ expiryDate: 1 });

    const serialized = serializeBatches(batches, req.user?.role);
    res.json(serialized);
  } catch (e: any) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /:id/batches — create batch for a product ─────────────────────────────
router.post('/:id/batches', requireAnyAdmin, async (req: any, res) => {
  try {
    const {
      batchNumber,
      supplierId,
      purchaseDate,
      expiryDate,
      quantity,
      purchaseRate,
      gst,
      landedCost,
      status,
    } = req.body;

    if (!batchNumber || quantity == null) {
      return res.status(400).json({ error: 'batchNumber and quantity are required' });
    }

    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const numQty = Number(quantity);

    const batch = await Batch.create({
      productId: product._id,
      batchNumber,
      supplierId,
      purchaseDate: purchaseDate ? new Date(purchaseDate) : undefined,
      expiryDate: expiryDate ? new Date(expiryDate) : undefined,
      quantity: numQty,
      purchasedQuantity: numQty,
      receivedQuantity: numQty,
      availableQuantity: numQty,
      purchaseRate: purchaseRate != null ? Number(purchaseRate) : undefined,
      unitCost: purchaseRate != null ? Number(purchaseRate) : undefined,
      gst: gst != null ? Number(gst) : undefined,
      landedCost: landedCost != null ? Number(landedCost) : undefined,
      status: status || 'active',
    });

    // Update product overall stock quantity
    product.stockQuantity = (product.stockQuantity || 0) + numQty;
    await product.save();

    await logAudit({
      tenantId: req.user.tenantId || 'shop',
      action: 'BATCH_CREATE',
      userId: req.user.id,
      collection: 'batches',
      documentId: batch._id,
      before: null,
      after: batch.toObject(),
    });

    const serialized = serializeBatch(batch, req.user?.role);
    res.status(201).json(serialized);
  } catch (e: any) {
    if (e.code === 11000) return res.status(409).json({ error: 'Batch number already exists for this product' });
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST / — create product (admin) ──────────────────────────────────────────
router.post('/', requireAnyAdmin, async (req: any, res) => {
  try {
    const {
      company,
      brand,
      name,
      code,
      category,
      productType,
      hsnCode,
      packSize,
      unit,
      baseStockUnit,
      batchTracking,
      expiryTracking,
      mrp,
      purchaseRate,
      rateTaxBasis,
      gstRate,
      gstInclusive,
      discountAmount,
      discountPercentage,
      gstAmount,
      totalPurchaseCost,
      landedCostPerUnit,
      stockQuantity,
      image,
      usageInstructions,
      approvedSellingRate,
      sellingDiscountPercent,
    } = req.body;

    if (!company || !name || !code || !category || !baseStockUnit) {
      return res.status(400).json({ error: 'company, name, code, category, baseStockUnit are required' });
    }

    const existing = await Product.findOne({ code });
    if (existing) return res.status(409).json({ error: 'Product code already exists' });

    const isFinancial = isFinancialAuthorized(req.user?.role);

    const product = await Product.create({
      company,
      brand,
      name,
      code,
      category,
      productType,
      hsnCode,
      packSize,
      unit,
      baseStockUnit,
      batchTracking: batchTracking ?? false,
      expiryTracking: expiryTracking ?? false,
      mrp: mrp != null ? Number(mrp) : undefined,
      purchaseRate: isFinancial && purchaseRate != null ? Number(purchaseRate) : undefined,
      rateTaxBasis: isFinancial && rateTaxBasis ? rateTaxBasis : 'inclusive',
      gstRate: gstRate != null ? Number(gstRate) : 0,
      gstInclusive: gstInclusive ?? true,
      discountAmount: isFinancial && discountAmount != null ? Number(discountAmount) : 0,
      discountPercentage: isFinancial && discountPercentage != null ? Number(discountPercentage) : 0,
      gstAmount: isFinancial && gstAmount != null ? Number(gstAmount) : 0,
      totalPurchaseCost: isFinancial && totalPurchaseCost != null ? Number(totalPurchaseCost) : undefined,
      landedCostPerUnit: isFinancial && landedCostPerUnit != null ? Number(landedCostPerUnit) : undefined,
      stockQuantity: stockQuantity != null ? Number(stockQuantity) : 0,
      image,
      usageInstructions: usageInstructions || {},
      approvedSellingRate: approvedSellingRate != null ? Number(approvedSellingRate) : undefined,
      sellingDiscountPercent: sellingDiscountPercent != null ? Number(sellingDiscountPercent) : 0,
      isActive: true,
    });

    await logAudit({
      tenantId: req.user.tenantId || 'shop',
      action: 'PRODUCT_CREATE',
      userId: req.user.id,
      collection: 'products',
      documentId: product._id,
      before: null,
      after: product.toObject(),
    });

    const serialized = serializeProduct(product, req.user?.role);
    res.status(201).json(serialized);
  } catch (e: any) {
    console.error('[products POST]', e);
    if (e.code === 11000) return res.status(409).json({ error: 'Product code already in use' });
    res.status(500).json({ error: 'Server error' });
  }
});

// ── PUT /:id — update product ─────────────────────────────────────────────────
router.put('/:id', requireAnyAdmin, async (req: any, res) => {
  try {
    const before = await Product.findById(req.params.id);
    if (!before) return res.status(404).json({ error: 'Product not found' });

    const updates = { ...req.body };
    delete updates._id;
    delete updates.__v;
    delete updates.createdAt;
    delete updates.updatedAt;

    // Redact sensitive financial updates if non-financial role attempts to set them
    if (!isFinancialAuthorized(req.user?.role)) {
      delete updates.purchaseRate;
      delete updates.rateTaxBasis;
      delete updates.totalPurchaseCost;
      delete updates.landedCostPerUnit;
      delete updates.discountAmount;
      delete updates.discountPercentage;
      delete updates.gstAmount;
    }

    const product = await Product.findByIdAndUpdate(req.params.id, updates, { new: true });

    await logAudit({
      tenantId: req.user.tenantId || 'shop',
      action: 'PRODUCT_UPDATE',
      userId: req.user.id,
      collection: 'products',
      documentId: product!._id,
      before: before.toObject(),
      after: product!.toObject(),
    });

    const serialized = serializeProduct(product, req.user?.role);
    res.json(serialized);
  } catch (e: any) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── PUT /:id/selling-price — owner sets approved rate ────────────────────────
router.put('/:id/selling-price', requireAnyAdmin, async (req: any, res) => {
  try {
    const { approvedSellingRate, sellingDiscountPercent, mrp } = req.body;
    if (approvedSellingRate == null) {
      return res.status(400).json({ error: 'approvedSellingRate is required' });
    }
    if (Number(approvedSellingRate) <= 0) {
      return res.status(400).json({ error: 'approvedSellingRate must be positive' });
    }

    const updates: any = { approvedSellingRate: Number(approvedSellingRate) };
    if (sellingDiscountPercent != null) updates.sellingDiscountPercent = Number(sellingDiscountPercent);
    if (mrp != null) updates.mrp = Number(mrp);

    const product = await Product.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const serialized = serializeProduct(product, req.user?.role);
    res.json(serialized);
  } catch (e: any) {
    console.error('[products selling-price]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
