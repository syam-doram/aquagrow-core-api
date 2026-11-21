// whatsapp.ts — WhatsApp messaging models for shop ERP
//
// NOTE: `WhatsAppJob` (for PDF delivery to AquaGrow farmers) already lives in db.ts.
// These three models cover the shop ERP messaging layer and are distinct collections.
import mongoose from 'mongoose';

// ── WhatsAppMessage ───────────────────────────────────────────────────────────
// Tracks individual messages sent to shop farmers via WhatsApp.
const WhatsAppMessageSchema = new mongoose.Schema(
  {
    farmerId:          { type: String },
    phoneNumber:       { type: String },
    messageType: {
      type: String,
      enum: ['invoice', 'expiry_alert', 'payment_reminder'],
    },
    referenceId:       { type: mongoose.Schema.Types.ObjectId },
    status: {
      type: String,
      enum: ['pending', 'sent', 'delivered', 'failed'],
      default: 'pending',
    },
    retryCount:        { type: Number, default: 0 },
    providerMessageId: { type: String },
    failureReason:     { type: String },
    sentAt:            { type: Date },
    content:           { type: String },
  },
  { timestamps: true, collection: 'whatsappmessages' }
);

export const WhatsAppMessage =
  mongoose.models['WhatsAppMessage'] ?? mongoose.model('WhatsAppMessage', WhatsAppMessageSchema);

// ── WhatsAppTemplate ──────────────────────────────────────────────────────────
// Reusable message templates.
const WhatsAppTemplateSchema = new mongoose.Schema(
  {
    name:     { type: String, unique: true },
    content:  { type: String },
    type:     { type: String },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'whatsapptemplates' }
);

export const WhatsAppTemplate =
  mongoose.models['WhatsAppTemplate'] ?? mongoose.model('WhatsAppTemplate', WhatsAppTemplateSchema);

// ── WhatsAppAlertSetting ──────────────────────────────────────────────────────
// Per-alert-type settings (enable/disable, timing, etc.)
const WhatsAppAlertSettingSchema = new mongoose.Schema(
  {
    alertType:        { type: String, unique: true },
    enabled:          { type: Boolean, default: true },
    daysBeforeExpiry: { type: [Number], default: [30, 15, 7] },
    updatedBy:        { type: String },
  },
  { timestamps: true, collection: 'whatsappalertsettings' }
);

export const WhatsAppAlertSetting =
  mongoose.models['WhatsAppAlertSetting'] ??
  mongoose.model('WhatsAppAlertSetting', WhatsAppAlertSettingSchema);
