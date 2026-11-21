// role.ts — Dynamic Roles and Role-Based Permissions
import mongoose from 'mongoose';

const RolePermissionSchema = new mongoose.Schema(
  {
    name:        { type: String, required: true, unique: true }, // e.g., 'Shop Admin', 'Inventory Manager'
    roleKey:     { type: String, required: true, unique: true }, // e.g., 'shop_admin', 'inventory_manager'
    description: { type: String },
    permissions: [{ type: String }], // list of permission strings e.g. 'products:read', 'financial:rates'
    isSystem:    { type: Boolean, default: false }, // system roles cannot be deleted
    isActive:    { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'shoproles' }
);

export const ALL_SYSTEM_PERMISSIONS = [
  // Products
  'products:view',
  'products:create',
  'products:edit',
  'products:delete',
  'products:rates:view',     // sensitive purchase rate & landed cost
  'products:pricing:manage', // approve selling rates
  // Sales / Billing
  'sales:view',
  'sales:create',
  'sales:discount:override',
  'sales:return',
  'sales:cancel',
  // Wholesale / Purchases
  'purchases:view',
  'purchases:create',
  'purchases:receive',
  'purchases:expenses',
  'purchases:rates:view',    // sensitive wholesale supplier rates
  // Farmers & Cultures
  'farmers:view',
  'farmers:create',
  'farmers:edit',
  'farmers:credit:manage',
  'cultures:manage',
  // Finance & Reports
  'finance:ledger:view',
  'finance:reports:view',
  'finance:profit:view',
  // Administration
  'staff:manage',
  'roles:manage',
  'audit:view',
  'whatsapp:manage',
];

export const ShopRole =
  mongoose.models['ShopRole'] ?? mongoose.model('ShopRole', RolePermissionSchema);
