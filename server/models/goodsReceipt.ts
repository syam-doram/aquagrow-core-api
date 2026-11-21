// goodsReceipt.ts — ERP goods receipt note
// receiptNumber format: GR-YYYYMMDD-XXX
import mongoose from 'mongoose';

const GoodsReceiptItemSchema = new mongoose.Schema(
  {
    purchaseItemId: { type: mongoose.Schema.Types.ObjectId },
    productId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    productName:    { type: String },
    acceptedQty:    { type: Number, required: true },
    damagedQty:     { type: Number, default: 0 },
    missingQty:     { type: Number, default: 0 },
    pendingQty:     { type: Number, default: 0 },
    batchNumber:    { type: String },
    expiryDate:     { type: Date },
    inwardDate:     { type: Date, default: Date.now },
  },
  { _id: true }
);

const GoodsReceiptSchema = new mongoose.Schema(
  {
    purchaseOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseOrder', required: true },
    receiptNumber:   { type: String, unique: true, required: true },
    receiptDate:     { type: Date, default: Date.now },
    receivedBy:      { type: String, required: true },
    items:           [GoodsReceiptItemSchema],
    notes:           { type: String },
  },
  { timestamps: true, collection: 'goodsreceipts' }
);

export const GoodsReceipt =
  mongoose.models['GoodsReceipt'] ?? mongoose.model('GoodsReceipt', GoodsReceiptSchema);
