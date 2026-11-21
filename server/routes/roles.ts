/**
 * Dynamic Roles & Permissions Route
 * Mounted at /api/shop/roles
 *
 * GET /api/shop/roles             — list configurable roles
 * POST /api/shop/roles            — create custom role (super_admin)
 * PUT  /api/shop/roles/:id        — update role permissions (super_admin)
 * GET  /api/shop/permissions      — list all available permission keys
 * PUT  /api/shop/users/:id/roles  — assign roles to staff user
 */
import express from 'express';
import { ShopRole, ALL_SYSTEM_PERMISSIONS } from '../models/role.js';
import { AdminUser } from '../models/adminUser.js';
import { authenticate, requireSuperAdmin } from '../middleware/auth.js';
import { logAudit } from '../utils/auditLog.js';

const router = express.Router();
router.use(authenticate);

// ── GET / — list roles ────────────────────────────────────────────────────────
router.get('/', async (_req, res) => {
  try {
    let roles = await ShopRole.find().sort({ name: 1 });
    if (!roles.length) {
      // Seed default initial system roles if empty
      const defaultRoles = [
        { name: 'Super Admin', roleKey: 'super_admin', isSystem: true, permissions: ALL_SYSTEM_PERMISSIONS },
        { name: 'Shop Admin', roleKey: 'shop_admin', isSystem: true, permissions: ALL_SYSTEM_PERMISSIONS.filter(p => !p.startsWith('roles:')) },
        { name: 'Accountant', roleKey: 'finance_admin', isSystem: true, permissions: ['sales:view', 'purchases:view', 'purchases:rates:view', 'finance:ledger:view', 'finance:reports:view', 'finance:profit:view'] },
        { name: 'Billing Staff / Cashier', roleKey: 'billing_staff', isSystem: true, permissions: ['sales:view', 'sales:create', 'farmers:view', 'farmers:create', 'products:view'] },
        { name: 'Stock Staff / Warehouse', roleKey: 'stock_staff', isSystem: true, permissions: ['products:view', 'products:create', 'purchases:receive', 'purchases:view'] },
      ];
      roles = await ShopRole.insertMany(defaultRoles);
    }
    res.json(roles);
  } catch (e: any) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /permissions — list system permissions ────────────────────────────────
router.get('/permissions', async (_req, res) => {
  res.json({ permissions: ALL_SYSTEM_PERMISSIONS });
});

// ── POST / — create custom role ───────────────────────────────────────────────
router.post('/', requireSuperAdmin, async (req: any, res) => {
  try {
    const { name, roleKey, description, permissions } = req.body;
    if (!name || !roleKey) return res.status(400).json({ error: 'name and roleKey are required' });

    const role = await ShopRole.create({
      name,
      roleKey,
      description,
      permissions: permissions || [],
      isSystem: false,
    });

    await logAudit({
      tenantId: req.user.tenantId || 'shop',
      action: 'ROLE_CREATE',
      userId: req.user.id,
      collection: 'shoproles',
      documentId: role._id,
      before: null,
      after: role.toObject(),
    });

    res.status(201).json(role);
  } catch (e: any) {
    if (e.code === 11000) return res.status(409).json({ error: 'Role name or key already exists' });
    res.status(500).json({ error: 'Server error' });
  }
});

// ── PUT /:id — update role permissions ────────────────────────────────────────
router.put('/:id', requireSuperAdmin, async (req: any, res) => {
  try {
    const { name, description, permissions, isActive } = req.body;
    const role = await ShopRole.findByIdAndUpdate(
      req.params.id,
      { name, description, permissions, isActive },
      { new: true }
    );
    if (!role) return res.status(404).json({ error: 'Role not found' });
    res.json(role);
  } catch (e: any) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── PUT /users/:id/roles — assign role to staff user ──────────────────────────
router.put('/users/:id/roles', requireSuperAdmin, async (req: any, res) => {
  try {
    const { role } = req.body;
    if (!role) return res.status(400).json({ error: 'Role is required' });

    const user = await AdminUser.findByIdAndUpdate(req.params.id, { role }, { new: true });
    if (!user) return res.status(404).json({ error: 'User not found' });

    await logAudit({
      tenantId: req.user.tenantId || 'shop',
      action: 'USER_ROLE_ASSIGN',
      userId: req.user.id,
      collection: 'staffusers',
      documentId: user._id,
      before: null,
      after: { userId: user._id, newRole: role },
    });

    res.json({ message: 'User role updated', user });
  } catch (e: any) {
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
