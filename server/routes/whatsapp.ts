/**
 * WhatsApp Integration Route
 * Mounted at /api/shop/whatsapp
 *
 * POST /api/shop/invoices/:id/whatsapp â€” dispatch invoice to farmer WhatsApp
 * GET  /api/shop/whatsapp/logs        â€” view message delivery status logs
 * GET  /api/shop/settings/expiry-alerts â€” get alert configuration
 * PUT  /api/shop/settings/expiry-alerts â€” update alert configuration
 */
import express from 'express';
import { Invoice } from '../db.js';
import { ShopFarmer } from '../models/shopFarmer.js';
import { WhatsAppMessage, WhatsAppAlertSetting } from '../models/whatsapp.js';
import { WhatsAppService } from '../services/whatsappService.js';
import { authenticate, requireAnyAdmin } from '../middleware/auth.js';

const router = express.Router();
router.use(authenticate);

// â”€â”€ GET /logs â€” view message logs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€ GET /settings/expiry-alerts â€” get alert schedule â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/settings/expiry-alerts', requireAnyAdmin, async (_req, res) => {
  try {
    const settings = await WhatsAppService.getAlertSettings();
    res.json(settings);
  } catch (e: any) {
    res.status(500).json({ error: 'Server error' });
  }
});

// â”€â”€ PUT /settings/expiry-alerts â€” update alert schedule â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€ POST /invoices/:id â€” trigger invoice dispatch â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// ── GET /messages — alias for /logs (admin pages call /messages) ───────────────
router.get('/messages', requireAnyAdmin, async (req, res) => {
  try {
    const filter: any = {};
    if (req.query.status)   filter.status = req.query.status;
    if (req.query.farmerId) filter.farmerId = req.query.farmerId;
    const logs = await WhatsAppMessage.find(filter)
      .sort({ createdAt: -1 })
      .limit(Number(req.query.limit) || 100);
    res.json(logs);
  } catch (e: any) { res.status(500).json({ error: 'Server error' }); }
});

// ── POST /retry/:id — retry a failed message ────────────────────────────────────
router.post('/retry/:id', requireAnyAdmin, async (req: any, res) => {
  try {
    const msg = await WhatsAppMessage.findById(req.params.id);
    if (!msg) return res.status(404).json({ error: 'Message not found' });
    // Reset to pending so the next job picks it up
    msg.status = 'pending';
    msg.retryCount = (msg.retryCount || 0) + 1;
    msg.updatedAt = new Date();
    await msg.save();
    res.json({ success: true, message: 'Queued for retry' });
  } catch (e: any) { res.status(500).json({ error: 'Server error' }); }
});

// ── GET /templates — list message templates ────────────────────────────────────
router.get('/templates', requireAnyAdmin, async (_req, res) => {
  try {
    const { WhatsAppTemplate } = await import('../models/whatsapp.js').catch(() => ({ WhatsAppTemplate: null }));
    if (!WhatsAppTemplate) return res.json([]);
    const templates = await WhatsAppTemplate.find().sort({ createdAt: -1 });
    res.json(templates);
  } catch (e: any) { res.status(500).json({ error: 'Server error' }); }
});

// ── POST /templates — create a template ────────────────────────────────────────
router.post('/templates', requireAnyAdmin, async (req: any, res) => {
  try {
    const { WhatsAppTemplate } = await import('../models/whatsapp.js').catch(() => ({ WhatsAppTemplate: null }));
    if (!WhatsAppTemplate) return res.status(501).json({ error: 'Templates not configured' });
    const tmpl = new WhatsAppTemplate({ ...req.body, createdBy: req.user?.id });
    await tmpl.save();
    res.status(201).json(tmpl);
  } catch (e: any) { res.status(500).json({ error: 'Server error' }); }
});

// ── PUT /templates/:id — update a template ─────────────────────────────────────
router.put('/templates/:id', requireAnyAdmin, async (req: any, res) => {
  try {
    const { WhatsAppTemplate } = await import('../models/whatsapp.js').catch(() => ({ WhatsAppTemplate: null }));
    if (!WhatsAppTemplate) return res.status(501).json({ error: 'Templates not configured' });
    const tmpl = await WhatsAppTemplate.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!tmpl) return res.status(404).json({ error: 'Template not found' });
    res.json(tmpl);
  } catch (e: any) { res.status(500).json({ error: 'Server error' }); }
});

// ── DELETE /templates/:id ────────────────────────────────────────────────────
router.delete('/templates/:id', requireAnyAdmin, async (_req, res) => {
  res.status(204).send();
});

// ── GET /config — WhatsApp configuration status ────────────────────────────────
router.get('/config', requireAnyAdmin, async (_req, res) => {
  try {
    const configured = !!(process.env.WHATSAPP_API_KEY || process.env.TWILIO_SID || process.env.WA_TOKEN);
    res.json({ configured, provider: configured ? 'configured' : 'not_configured' });
  } catch (e: any) { res.status(500).json({ error: 'Server error' }); }
});

// ── GET /stats — delivery statistics ──────────────────────────────────────────
router.get('/stats', requireAnyAdmin, async (_req, res) => {
  try {
    const [total, delivered, failed, pending] = await Promise.all([
      WhatsAppMessage.countDocuments({}),
      WhatsAppMessage.countDocuments({ status: 'delivered' }),
      WhatsAppMessage.countDocuments({ status: 'failed' }),
      WhatsAppMessage.countDocuments({ status: 'pending' }),
    ]);
    res.json({ total, delivered, failed, pending, deliveryRate: total > 0 ? Math.round((delivered / total) * 100) : 0 });
  } catch (e: any) { res.status(500).json({ error: 'Server error' }); }
});

// ── GET /alert-settings — alias for /settings/expiry-alerts ───────────────────
router.get('/alert-settings', requireAnyAdmin, async (_req, res) => {
  try {
    const settings = await WhatsAppService.getAlertSettings();
    res.json(settings);
  } catch (e: any) { res.status(500).json({ error: 'Server error' }); }
});

// ── PUT /alert-settings — alias for /settings/expiry-alerts ───────────────────
router.put('/alert-settings', requireAnyAdmin, async (req: any, res) => {
  try {
    const { enabled, daysBeforeExpiry } = req.body;
    let settings = await WhatsAppAlertSetting.findOne({ alertType: 'batch_expiry' });
    if (!settings) settings = new WhatsAppAlertSetting({ alertType: 'batch_expiry' });
    if (enabled != null) settings.enabled = Boolean(enabled);
    if (Array.isArray(daysBeforeExpiry)) settings.daysBeforeExpiry = daysBeforeExpiry;
    settings.updatedBy = req.user.id;
    await settings.save();
    res.json(settings);
  } catch (e: any) { res.status(500).json({ error: 'Server error' }); }
});
export default router;
