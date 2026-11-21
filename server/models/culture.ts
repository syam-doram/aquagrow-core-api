// culture.ts — shop farmer crop/culture cycle
//
// NOTE: `Culture` is already registered in db.ts (links AquaGrow app farmer + pond).
// This model is named `ShopCulture` to avoid a Mongoose OverwriteModelError,
// and uses the collection `shopculturecycles` to stay separate.
import mongoose from 'mongoose';

const ShopCultureSchema = new mongoose.Schema(
  {
    cultureId:      { type: String, unique: true }, // human-readable: CULT-2026-001
    farmerId:       { type: mongoose.Schema.Types.ObjectId, ref: 'ShopFarmer', required: true },
    startDate:      { type: Date, required: true, default: Date.now },
    endDate:        { type: Date },
    status:         { type: String, enum: ['active', 'closed'], default: 'active' },
    notes:          { type: String },
    totalPurchased: { type: Number, default: 0 }, // ₹ purchased on credit
    totalPaid:      { type: Number, default: 0 },  // ₹ paid so far
    createdBy:      { type: String },              // staff user id
  },
  { timestamps: true, collection: 'shopculturecycles' }
);

ShopCultureSchema.index({ farmerId: 1, status: 1 });

export const ShopCulture =
  mongoose.models['ShopCulture'] ?? mongoose.model('ShopCulture', ShopCultureSchema);
