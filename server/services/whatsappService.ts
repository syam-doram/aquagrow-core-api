/**
 * WhatsApp Business API Provider Abstraction
 * ─────────────────────────────────────────────────────────────────────────────
 * Safe provider service for invoice delivery and expiry alerts.
 * If credentials are not configured, it records message logs with status 'unconfigured'
 * without throwing or blocking operations.
 */
import { WhatsAppMessage, WhatsAppAlertSetting } from '../models/whatsapp.js';

export interface SendInvoiceMessageParams {
  farmerId: string;
  phoneNumber: string;
  farmerName: string;
  invoiceId: string;
  totalAmount: number;
  items: Array<{ name: string; quantity: number; unit?: string; total: number }>;
  pdfUrl?: string;
  creditBalance?: number;
}

export class WhatsAppService {
  private static isConfigured(): boolean {
    return Boolean(process.env.WHATSAPP_API_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
  }

  /**
   * Sends or queues an invoice notification message
   */
  static async sendInvoiceNotification(params: SendInvoiceMessageParams): Promise<any> {
    const { farmerId, phoneNumber, invoiceId, totalAmount, items, creditBalance, pdfUrl } = params;

    const itemsSummary = items
      .map(i => `• ${i.name}: ${i.quantity} ${i.unit || 'units'} = ₹${i.total}`)
      .join('\n');

    const content = `*AquaGrow Shop Invoice*
Invoice ID: ${invoiceId}
Total Amount: ₹${totalAmount}
${creditBalance != null ? `Outstanding Balance: ₹${creditBalance}\n` : ''}
*Items:*
${itemsSummary}
${pdfUrl ? `\nDownload Bill: ${pdfUrl}` : ''}
Thank you for your business!`;

    const message = await WhatsAppMessage.create({
      farmerId,
      phoneNumber,
      messageType: 'invoice',
      content,
      status: this.isConfigured() ? 'pending' : 'failed',
      failureReason: this.isConfigured() ? undefined : 'WhatsApp API provider credentials not configured',
      sentAt: this.isConfigured() ? new Date() : undefined,
    });

    if (!this.isConfigured()) {
      return {
        success: false,
        configured: false,
        message: 'WhatsApp integration is currently unconfigured. Notification logged.',
        logId: message._id,
      };
    }

    try {
      // Real API call when WHATSAPP_API_TOKEN is provided:
      // (Using standard Meta WhatsApp Cloud API endpoint)
      const res = await fetch(`https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: phoneNumber.replace(/\D/g, ''),
          type: 'text',
          text: { body: content },
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        message.status = 'sent';
        message.providerMessageId = data.messages?.[0]?.id;
        await message.save();
        return { success: true, messageId: message.providerMessageId };
      } else {
        message.status = 'failed';
        message.failureReason = data.error?.message || 'API request rejected';
        await message.save();
        return { success: false, error: message.failureReason };
      }
    } catch (err: any) {
      message.status = 'failed';
      message.failureReason = err.message;
      await message.save();
      return { success: false, error: err.message };
    }
  }

  /**
   * Check alert settings for batch expiry notifications
   */
  static async getAlertSettings(): Promise<any> {
    let settings = await WhatsAppAlertSetting.findOne({ alertType: 'batch_expiry' });
    if (!settings) {
      settings = await WhatsAppAlertSetting.create({
        alertType: 'batch_expiry',
        enabled: true,
        daysBeforeExpiry: [30, 15, 7],
      });
    }
    return settings;
  }
}
