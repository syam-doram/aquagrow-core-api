// supplier.ts — ERP supplier entity
import mongoose from 'mongoose';

const SupplierSchema = new mongoose.Schema(
  {
    name:        { type: String, required: true },
    phoneNumber: { type: String },
    email:       { type: String },
    address:     { type: String },
    gstin:       { type: String },
    notes:       { type: String },
    isActive:    { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'suppliers' }
);

export const Supplier =
  mongoose.models['Supplier'] ?? mongoose.model('Supplier', SupplierSchema);
