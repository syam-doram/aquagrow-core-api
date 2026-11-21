// purchaseExpense.ts — costs attached to a purchase order (transport, loading, etc.)
import mongoose from 'mongoose';

const VehicleDetailsSchema = new mongoose.Schema(
  {
    ownership:    { type: String, enum: ['own', 'hired'] },
    vehicleType:  { type: String, enum: ['auto', 'mini_lorry', 'lorry', 'truck', 'other'] },
    vehicleNumber: { type: String },
    driverName:   { type: String },
    driverPhone:  { type: String },
    from:         { type: String },
    to:           { type: String },
  },
  { _id: false }
);

const PurchaseExpenseSchema = new mongoose.Schema(
  {
    purchaseOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseOrder', required: true },
    category: {
      type: String,
      enum: ['transport', 'own_vehicle_fuel', 'vehicle_rental', 'loading', 'unloading', 'other'],
      required: true,
    },
    amount:         { type: Number, required: true, min: 0 },
    expenseDate:    { type: Date, default: Date.now },
    notes:          { type: String },
    vehicleDetails: { type: VehicleDetailsSchema },
    attachmentUrl:  { type: String },
    createdBy:      { type: String, required: true },
  },
  { timestamps: true, collection: 'purchaseexpenses' }
);

export const PurchaseExpense =
  mongoose.models['PurchaseExpense'] ?? mongoose.model('PurchaseExpense', PurchaseExpenseSchema);
