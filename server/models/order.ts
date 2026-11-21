// order.ts — Farmer Orders and Partial Deliveries
import mongoose from 'mongoose';

export type OrderStatus = 'Pending' | 'Confirmed' | 'Partially Delivered' | 'Delivered' | 'Cancelled';

const OrderItemSchema = new mongoose.Schema(
  {
    productId:         { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    productName:       { type: String, required: true },
    unit:              { type: String, default: 'kg' },
    orderedQuantity:   { type: Number, required: true, min: 0.01 },
    deliveredQuantity: { type: Number, default: 0 },
    remainingQuantity: { type: Number, default: 0 },
    rate:              { type: Number, required: true },
    total:             { type: Number, required: true },
  },
  { _id: true }
);

const DeliveryRecordSchema = new mongoose.Schema(
  {
    deliveryNumber: { type: String },
    deliveryDate:   { type: Date, default: Date.now },
    deliveredBy:    { type: String, required: true }, // staff id / name
    items: [
      {
        productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
        quantity:  { type: Number, required: true, min: 0.01 },
      },
    ],
    notes:          { type: String },
  },
  { _id: true, timestamps: true }
);

const OrderPaymentSchema = new mongoose.Schema(
  {
    amount:    { type: Number, required: true, min: 0 },
    method:    { type: String, enum: ['Cash', 'UPI', 'Bank', 'Credit'], default: 'Cash' },
    date:      { type: Date, default: Date.now },
    details:   { type: Map, of: String },
    createdBy: { type: String, required: true },
  },
  { _id: true, timestamps: true }
);

const ShopOrderSchema = new mongoose.Schema(
  {
    orderId:              { type: String, unique: true, required: true }, // ORD-YYYYMMDD-XXX
    farmerId:             { type: String, required: true, index: true },
    farmerName:           { type: String, required: true },
    farmerPhone:          { type: String },
    orderDate:            { type: Date, default: Date.now },
    expectedDeliveryDate: { type: Date },
    status: {
      type: String,
      enum: ['Pending', 'Confirmed', 'Partially Delivered', 'Delivered', 'Cancelled'],
      default: 'Pending',
    },
    items:          [OrderItemSchema],
    totalAmount:    { type: Number, required: true },
    advancePaid:    { type: Number, default: 0 },
    paymentBalance: { type: Number, default: 0 },
    deliveries:     [DeliveryRecordSchema],
    payments:       [OrderPaymentSchema],
    notes:          { type: String },
    createdBy:      { type: String, required: true },
  },
  { timestamps: true, collection: 'shoporders' }
);

ShopOrderSchema.index({ farmerId: 1, status: 1 });
ShopOrderSchema.index({ orderDate: -1 });

export const ShopOrder =
  mongoose.models['ShopOrder'] ?? mongoose.model('ShopOrder', ShopOrderSchema);
