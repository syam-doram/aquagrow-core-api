// saleReturn.ts — Sales Returns and Stock Inward Reversal
import mongoose from 'mongoose';

const SaleReturnItemSchema = new mongoose.Schema(
  {
    productId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    productName:  { type: String, required: true },
    quantity:     { type: Number, required: true, min: 0.01 },
    unit:         { type: String, default: 'kg' },
    rate:         { type: Number, required: true },
    refundAmount: { type: Number, required: true },
    batchId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Batch' },
    condition:    { type: String, enum: ['resalable', 'damaged'], default: 'resalable' },
  },
  { _id: true }
);

const SaleReturnSchema = new mongoose.Schema(
  {
    invoiceId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', required: true },
    farmerId:     { type: String, required: true, index: true },
    returnNumber: { type: String, unique: true, required: true }, // RET-YYYYMMDD-XXX
    items:        [SaleReturnItemSchema],
    totalRefund:  { type: Number, required: true },
    refundMethod: { type: String, enum: ['Cash', 'Credit Adjustment', 'UPI'], default: 'Credit Adjustment' },
    reason:       { type: String },
    createdBy:    { type: String, required: true },
  },
  { timestamps: true, collection: 'salereturns' }
);

export const SaleReturn =
  mongoose.models['SaleReturn'] ?? mongoose.model('SaleReturn', SaleReturnSchema);
