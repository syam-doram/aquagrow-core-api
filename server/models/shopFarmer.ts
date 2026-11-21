// shopFarmer.ts — shop-registered farmer (separate from AquaGrow app User)
import mongoose from 'mongoose';

const ShopFarmerSchema = new mongoose.Schema(
  {
    name:         { type: String, required: true, trim: true },
    phoneNumber:  { type: String, required: true, trim: true, unique: true },
    email:        { type: String, trim: true },
    address:      { type: String },
    village:      { type: String },
    district:     { type: String },
    notes:        { type: String },
    totalCredit:  { type: Number, default: 0 }, // outstanding balance in ₹
    isActive:     { type: Boolean, default: true },
    createdBy:    { type: String }, // staff user id who registered them
  },
  { timestamps: true, collection: 'shopfarmers' }
);

export const ShopFarmer =
  mongoose.models['ShopFarmer'] ?? mongoose.model('ShopFarmer', ShopFarmerSchema);
