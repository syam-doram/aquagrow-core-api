// purchaseOrder.ts — ERP purchase order
// poNumber format: PO-YYYYMMDD-XXX
import mongoose from 'mongoose';

const PurchaseOrderItemSchema = new mongoose.Schema(
  {
    productId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    productName:     { type: String },
    brandName:       { type: String },
    orderedQty:      { type: Number, required: true },
    receivedQty:     { type: Number, default: 0 },
    missingQty:      { type: Number, default: 0 },
    damagedQty:      { type: Number, default: 0 },
    rate:            { type: Number },
    discountPercent: { type: Number, default: 0 },
    gstPercent:      { type: Number, default: 0 },
    totalAmount:     { type: Number },
    batchNumber:     { type: String },
    expiryDate:      { type: Date },
  },
  { _id: true }
);

const PurchaseOrderSchema = new mongoose.Schema(
  {
    poNumber:              { type: String, unique: true, required: true },
    supplierId:            { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
    supplierName:          { type: String, required: true },
    supplierInvoiceNumber: { type: String },
    orderDate:             { type: Date, default: Date.now },
    expectedDeliveryDate:  { type: Date },
    receivedDate:          { type: Date },
    createdBy:             { type: String, required: true },
    status: {
      type: String,
      enum: ['draft', 'sent', 'partially_received', 'received', 'cancelled'],
      default: 'draft',
    },
    paymentStatus: {
      type: String,
      enum: ['unpaid', 'partial', 'paid'],
      default: 'unpaid',
    },
    items:                [PurchaseOrderItemSchema],
    notes:                { type: String },
    totalExpectedAmount:  { type: Number, default: 0 },
    totalReceivedAmount:  { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'purchaseorders' }
);

export const PurchaseOrder =
  mongoose.models['PurchaseOrder'] ?? mongoose.model('PurchaseOrder', PurchaseOrderSchema);
