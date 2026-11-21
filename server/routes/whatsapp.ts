/**
 * WhatsApp Integration Route
 * Mounted at /api/shop/whatsapp
 *
 * POST /api/shop/invoices/:id/whatsapp — dispatch invoice to farmer WhatsApp
 * GET  /api/shop/whatsapp/logs        — view message delivery status logs
 * GET  /api/shop/settings/expiry-alerts — get alert configuration
 * PUT  /api/shop/settings/expiry-alerts — update alert configuration
 */
import express from 'express';
import { Invoice } from '../db.js';
import { ShopFarmer } from '../models/shopFarmer.js';
import { WhatsAppMessage, WhatsAppAlertSetting } from '../models/whatsapp.js';
import { WhatsAppService } from '../services/whatsappService.js';
import { authenticate, requireAnyAdmin } from '../middleware/auth.js';

const router = express.Router();
router.use(authenticate);

// ── GET /logs — view message logs ─────────────────────────────────────────────
router.get('/logs', requireAnyAdmin, async (req, res) => {
  try {
    const filter: any = {};
    if (req.query.status)   filter.status = req.query.status;
    if (req.query.farmerId) filter.farmerId = req.query.farmerId;

    const logs = await WhatsAppMessage.find(filter)
      .sort({ createdAt: -1 })
      .limit(Number(req.query.limit) || 100);

    res.json(logs);
  } catch (e: any) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /settings/expiry-alerts — get alert schedule ──────────────────────────
router.get('/settings/expiry-alerts', requireAnyAdmin, async (_req, res) => {
  try {
    const settings = await WhatsAppService.getAlertSettings();
    res.json(settings);
  } catch (e: any) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── PUT /settings/expiry-alerts — update alert schedule ───────────────────────
router.put('/settings/expiry-alerts', requireAnyAdmin, async (req: any, res) => {
  try {
    const { enabled, daysBeforeExpiry } = req.body;
    let settings = await WhatsAppAlertSetting.findOne({ alertType: 'batch_expiry' });
    if (!settings) {
      settings = new WhatsAppAlertSetting({ alertType: 'batch_expiry' });
    }

    if (enabled != null) settings.enabled = Boolean(enabled);
    if (Array.isArray(daysBeforeExpiry)) settings.daysBeforeExpiry = daysBeforeExpiry;
    settings.updatedBy = req.user.id;
    await settings.save();

    res.json(settings);
  } catch (e: any) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /invoices/:id — trigger invoice dispatch ─────────────────────────────
router.post('/invoices/:id', async (req: any, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id).populate('items.productId', 'name unit');
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    let farmerPhone = req.body.phoneNumber;
    let farmerName = req.body.farmerName || 'Farmer';
    let creditBalance = 0;

    if (!farmerPhone) {
      const farmer = await ShopFarmer.findById(invoice.farmerId);
      if (farmer) {
        farmerPhone = farmer.phoneNumber;
        farmerName = farmer.name;
        creditBalance = farmer.totalCredit || 0;
      }
    }

    if (!farmerPhone) {
      return res.status(400).json({ error: 'Farmer phone number is required to send WhatsApp' });
    }

    const itemsSummary = invoice.items.map((it: any) => ({
      name: it.productId?.name || 'Item',
      quantity: it.quantity,
      unit: it.productId?.unit || 'units',
      total: it.total,
    }));

    const result = await WhatsAppService.sendInvoiceNotification({
      farmerId: invoice.farmerId,
      phoneNumber: farmerPhone,
      farmerName,
      invoiceId: invoice._id.toString(),
      totalAmount: invoice.totalAmount,
      items: itemsSummary,
      creditBalance,
    });

    res.json(result);
  } catch (e: any) {
    console.error('[whatsapp invoice send]', e);
    res.status(500).json({ error: 'Server error: ' + e.message });
  }
});

export default router;
