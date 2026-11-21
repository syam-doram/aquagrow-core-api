import 'dotenv/config';
import express, { Request } from 'express';
import bcrypt from 'bcryptjs';

type AuthenticatedRequest = any;
import mongoose from 'mongoose';
import cors from 'cors';
import { User as UserMongo, AdminUser as AdminUserMongo, Subscription as SubscriptionMongo, RefreshToken, connectDB, Pond as PondMongo, FeedLog as FeedLogMongo, MedicineLog as MedicineLogMongo, WaterLog as WaterLogMongo, SOPLog as SOPLogMongo, Expense as ExpenseMongo, HarvestRequest, ROIEntry as ROIEntryMongo, NotificationLog as NotificationLogMongo, AeratorLog as AeratorLogMongo } from './db.js';
import { apiLimiter, authenticate, requireRole, requireAnyAdmin, requireSuperAdmin, requireSelf, isAdminRole } from './middleware/auth.js';
import { GoogleGenAI } from "@google/genai";
import authRoutes from './routes/auth.js';
import providerRoutes from './routes/provider.js';
import hrmsRoutes from './routes/hrms.js';
import espnowRoutes from './routes/espnow.js';
import deviceRoutes from './routes/device.js';
import masterboxRoutes from './routes/masterbox.js';
import { startIoTAlertJob } from './jobs/iotAlertJob.js';
import { connectProviderDB, isProviderDbReady } from './providerDb.js';
import staffRoutes from './routes/staff.js';
import receiptsRoutes from './routes/receipts.js';
import productsRoutes from './routes/products.js';
import invoicesRoutes from './routes/invoices.js';
import daycloseRoutes from './routes/dayclose.js';
import ledgerRoutes from './routes/ledger.js';
import farmersRoutes from './routes/farmers.js';
import harvestsRoutes from './routes/harvests.js';
import suppliersRoutes from './routes/suppliers.js';
import purchaseOrdersRoutes from './routes/purchaseOrders.js';
import shopFarmersRoutes from './routes/shopFarmers.js';
import shopCulturesRoutes from './routes/shopCultures.js';
import salesRoutes from './routes/sales.js';
import shopOrdersRoutes from './routes/shopOrders.js';
import dashboardRoutes from './routes/dashboard.js';
import reportsRoutes from './routes/reports.js';
import rolesRoutes from './routes/roles.js';
import auditRoutes from './routes/audit.js';
import whatsappRoutes from './routes/whatsapp.js';

const app = express();
app.set('trust proxy', 1);
const PORT = Number(process.env.PORT) || 3005;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

const ALLOWED_ORIGINS = [
  ...(process.env.CORS_ORIGINS ?? '').split(',').map(origin => origin.trim()).filter(Boolean),
  'https://aquagrow.onrender.com',
  'https://aqua-grow.vercel.app',
  'https://aquagrow-admin.vercel.app',
  'https://aquagrowadmin.vercel.app',
  'https://aquagrowcompanyportal.vercel.app',   // âœ… Employee portal (Vercel)
  'https://aquagrow-staff.vercel.app',          // âœ… Staff portal (Vercel)
  'https://aqua-grow-staff.vercel.app',         // âœ… Staff portal alternate URL
  'https://aquagrow-admin-p6msac1fo-syamkdoram-7863s-projects.vercel.app', // preview
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow no-origin requests (Postman, curl, server-to-server)
    if (!origin) return callback(null, true);
    // Always allow Capacitor / Ionic WebView (Android = https://localhost, iOS = capacitor://localhost)
    if (
      origin === 'https://localhost' ||
      origin === 'http://localhost' ||
      origin.startsWith('capacitor://') ||
      origin.startsWith('ionic://') ||
      origin.startsWith('http://localhost:') ||
      origin.startsWith('https://localhost:')
    ) return callback(null, true);
    // Allow known production domains
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    // Allow all Vercel preview deployments for aquagrow projects
    if (origin.endsWith('.vercel.app') && (
      origin.includes('aquagrow') || origin.includes('aqua-grow')
    )) return callback(null, true);
    // Block everything else
    callback(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
}));

// Both API versions use the same handlers, authentication, and database models.
const common = express.Router();
const farmer = express.Router();
const adminApi = express.Router();
const shopOrders = express.Router();
const iotStatus = express.Router();

app.get('/api/v1/ready', (_req, res) => {
  const ready = mongoose.connection.readyState === 1;
  res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'unavailable' });
});

app.use('/api', apiLimiter);
app.use('/api/v1', common);
app.use('/api/v1/farmer', farmer);
app.use('/api/v1/admin', adminApi);
app.use('/api/v1/shop', shopOrders);
app.use('/api/v1/iot', iotStatus);

app.use(['/api/auth', '/api/v1/auth'], authRoutes);
app.use(['/api/provider', '/api/v1/provider'], providerRoutes);
app.use(['/api/hrms', '/api/v1/hr'], hrmsRoutes);
app.use(['/api/espnow', '/api/v1/iot/espnow'], espnowRoutes);
app.use(['/api/masterbox', '/api/v1/iot/masterbox'], masterboxRoutes);
app.use(['/api/device', '/api/v1/iot/device'], deviceRoutes);

// Each ERP router owns its own resource path and permission middleware.
app.use(['/api/staff', '/api/shop/staff', '/api/v1/shop/staff'], staffRoutes);
app.use(['/api/receipts', '/api/shop/receipts', '/api/v1/shop/receipts'], receiptsRoutes);
app.use(['/api/products', '/api/shop/products', '/api/v1/shop/products'], productsRoutes);
app.use(['/api/invoices', '/api/shop/invoices', '/api/v1/shop/invoices'], invoicesRoutes);
app.use(['/api/dayclose', '/api/shop/dayclose', '/api/v1/shop/dayclose'], daycloseRoutes);
app.use(['/api/ledger', '/api/shop/ledger', '/api/v1/shop/ledger'], ledgerRoutes);
app.use(['/api/farmers', '/api/v1/shop/farmers'], farmersRoutes);
app.use(['/api/harvests', '/api/shop/harvests', '/api/v1/shop/harvests'], harvestsRoutes);

// â”€â”€ NEW AquaGrow Shop ERP Routes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.use(['/api/suppliers', '/api/shop/suppliers', '/api/v1/shop/suppliers'], suppliersRoutes);
app.use(['/api/purchase-orders', '/api/shop/purchases', '/api/v1/shop/purchases'], purchaseOrdersRoutes);
app.use(['/api/shop/farmers', '/api/v1/shop/custom-farmers'], shopFarmersRoutes);
app.use(['/api/shop/cultures', '/api/v1/shop/cultures'], shopCulturesRoutes);
app.use(['/api/shop/sales', '/api/v1/shop/sales'], salesRoutes);
app.use(['/api/shop/orders', '/api/v1/shop/orders'], shopOrdersRoutes);
app.use(['/api/shop/dashboard', '/api/v1/shop/dashboard'], dashboardRoutes);
app.use(['/api/shop/reports', '/api/v1/shop/reports'], reportsRoutes);
app.use(['/api/shop/roles', '/api/shop/permissions', '/api/v1/shop/roles'], rolesRoutes);
app.use(['/api/shop/audit-logs', '/api/v1/shop/audit-logs'], auditRoutes);
app.use(['/api/shop/whatsapp', '/api/v1/shop/whatsapp'], whatsappRoutes);

app.use('/api/admin', adminApi);
app.use('/api/shop', shopOrders);
app.use('/api/iot', iotStatus);
app.use('/api', common, farmer);

// â”€â”€â”€ Health â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
common.get('/health', (_req, res) =>
  res.json({
    status: 'ok',
    farmerDb: mongoose.connection.readyState,   // 1 = connected (aquagrow)
    providerDb: isProviderDbReady() ? 1 : 0,      // 1 = connected (aquagrow_providers)
  })
);

// â”€â”€â”€ App Version Management â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// âœ… HOW TO RELEASE A NEW VERSION:
//    1. Bump LATEST_APP_VERSION to the new version string  (e.g., "1.1.0")
//    2. If this is a SECURITY / CRITICAL hotfix, also bump MIN_APP_VERSION
//       so older clients are FORCED to update.
//    3. Add a line to RELEASE_NOTES describing the key changes.
//    4. Update CURRENT_APP_VERSION in src/hooks/useAppUpdate.ts to match the new APK.
//    5. Build & deploy the server. The mobile app will auto-detect on next launch.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const LATEST_APP_VERSION = '1.0.0';    // â† bump when you publish a new APK
const MIN_APP_VERSION = '1.0.0';    // â† bump only for forced/critical updates

const RELEASE_NOTES: string[] = [
  'Initial release â€” full AquaGrow farm management suite',
  'Feed tray monitoring with DOC 20 activation flow',
  'Medicine SOP scheduler with lunar cycle integration',
  'ROI entry with harvest size validation (min 10g ABW)',
];

const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.aquagrow.app';

common.get('/app-version', (_req, res) => {
  res.json({
    latestVersion: LATEST_APP_VERSION,
    minVersion: MIN_APP_VERSION,
    releaseNotes: RELEASE_NOTES,
    updateUrl: PLAY_STORE_URL,
    publishedAt: '2026-04-12T00:00:00Z',
  });
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—
//  SUBSCRIPTION                  â•‘
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// â”€â”€â”€ DB health guard (used in push routes that must read user) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const dbOffline = (res: any) =>
  res.status(503).json({ error: 'Database unavailable. Please try again later.' });

// Plan name â†’ subscriptionStatus mapping
const PLAN_STATUS_MAP: Record<string, string> = {
  free: 'free',
  pro: 'pro',
  pro_silver: 'pro_silver',
  pro_gold: 'pro_gold',
  pro_diamond: 'pro_diamond',
  // Aliases for UI plan names (e.g. 'aqua_9_diamond')
  aqua_1: 'pro',
  aqua_3: 'pro_silver',
  aqua_6: 'pro_gold',
  aqua_9: 'pro_diamond',
  enterprise: 'pro_diamond',
};

const PLAN_FEATURES_MAP: Record<string, string[]> = {
  free: ['basic_dashboard', 'pond_management'],
  pro: ['basic_dashboard', 'pond_management', 'ai_scans', 'advanced_analytics'],
  pro_silver: ['basic_dashboard', 'pond_management', 'ai_scans', 'advanced_analytics', 'live_monitor'],
  pro_gold: ['basic_dashboard', 'pond_management', 'ai_scans', 'advanced_analytics', 'live_monitor', 'market_trends', 'expert_consultation'],
  pro_diamond: ['basic_dashboard', 'pond_management', 'ai_scans', 'advanced_analytics', 'live_monitor', 'market_trends', 'expert_consultation', 'unlimited_scans', 'priority_support'],
  aqua_1: ['basic_dashboard', 'pond_management', 'ai_scans', 'advanced_analytics'],
  aqua_3: ['basic_dashboard', 'pond_management', 'ai_scans', 'advanced_analytics', 'live_monitor'],
  aqua_6: ['basic_dashboard', 'pond_management', 'ai_scans', 'advanced_analytics', 'live_monitor', 'market_trends', 'expert_consultation'],
  aqua_9: ['basic_dashboard', 'pond_management', 'ai_scans', 'advanced_analytics', 'live_monitor', 'market_trends', 'expert_consultation', 'unlimited_scans', 'priority_support'],
  enterprise: ['basic_dashboard', 'pond_management', 'ai_scans', 'advanced_analytics', 'live_monitor', 'market_trends', 'expert_consultation', 'unlimited_scans', 'priority_support'],
};

farmer.post('/subscription/upgrade', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const { planName } = req.body;
    if (!planName) return res.status(400).json({ error: 'planName is required' });
    const userId = req.user.id;

    const subscriptionStatus = PLAN_STATUS_MAP[planName] ?? 'pro';
    const features = PLAN_FEATURES_MAP[planName] ?? PLAN_FEATURES_MAP['pro'];
    const end = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

    const sub = await SubscriptionMongo.findOneAndUpdate(
      { userId },
      { planName, features, status: 'active', endDate: end },
      { upsert: true, new: true }
    );
    await UserMongo.findByIdAndUpdate(userId, { subscriptionStatus });
    res.json({ ...sub.toObject(), subscriptionStatus });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

farmer.get('/user/:userId/subscription', authenticate, requireSelf, async (req, res) => {
  try {
    const userId = req.params.userId;

    let sub = await SubscriptionMongo.findOne({ userId });
    if (!sub) {
      const defaultSub = { userId, planName: 'free', status: 'active', features: ['basic_dashboard', 'pond_management'], startDate: new Date(), endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) };
      sub = await new SubscriptionMongo(defaultSub).save();
    }
    res.json(sub);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—
//  NOTIFICATIONS                 â•‘
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

farmer.put('/user/:userId/notifications', authenticate, requireSelf, async (req, res) => {
  try {
    const { fcmToken, notifications } = req.body;
    if (mongoose.connection.readyState !== 1) return dbOffline(res);
    const user = await UserMongo.findByIdAndUpdate(req.params.userId, { fcmToken, notifications }, { new: true });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

farmer.patch('/user/:userId', authenticate, requireSelf, async (req, res) => {
  try {
    const userId = req.params.userId;
    const updates = req.body;

    // Safety: don't allow password or role updates via this endpoint
    delete updates.password;
    delete updates.role;
    delete updates.phoneNumber; // Phone is fixed for now

    if (mongoose.connection.readyState !== 1) return dbOffline(res);
    const user = await UserMongo.findByIdAndUpdate(userId, updates, { new: true });

    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—
//  PONDS                         â•‘
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

farmer.get('/user/:userId/ponds', authenticate, requireSelf, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return dbOffline(res);
    const ponds = await PondMongo.find({ userId: req.params.userId });
    res.json(ponds);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

farmer.post('/ponds', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const data = { ...req.body, userId: req.user.id };
    if (mongoose.connection.readyState !== 1) return dbOffline(res);
    res.json(await new PondMongo(data).save());
  } catch (e) { res.status(400).json({ error: e.message }); }
});

farmer.delete('/ponds/:id', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const pond = await PondMongo.findById(id);
    if (!pond) return res.status(404).json({ error: 'Pond not found' });
    if (String(pond.userId) !== req.user.id && req.user.role !== 'admin')
      return res.status(403).json({ error: 'Access denied' });
    await PondMongo.findByIdAndDelete(id);
    await FeedLogMongo.deleteMany({ pondId: id });
    await MedicineLogMongo.deleteMany({ pondId: id });
    await WaterLogMongo.deleteMany({ pondId: id });
    res.status(204).send();
  } catch (e) { res.status(500).json({ error: e.message }); }
});

farmer.put('/ponds/:id', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const pond = await PondMongo.findById(id);
    if (!pond) return res.status(404).json({ error: 'Pond not found' });
    if (String(pond.userId) !== req.user.id && req.user.role !== 'admin')
      return res.status(403).json({ error: 'Access denied' });

    if (mongoose.connection.readyState !== 1) return dbOffline(res);

    const updated = await PondMongo.findByIdAndUpdate(id, req.body, { new: true });

    // â”€â”€ If aerators were updated, also write to AeratorLog collection â”€â”€â”€â”€â”€â”€â”€â”€
    if (req.body.aerators) {
      const a = req.body.aerators;
      // Get the newest log entry (the one just added)
      const latestLog = Array.isArray(a.log) ? a.log[a.log.length - 1] : null;
      if (latestLog) {
        const recommended = Math.ceil((pond.size || 0) * 4);
        await new AeratorLogMongo({
          userId: req.user.id,
          pondId: id,
          pondName: (pond as any).name || '',
          doc: latestLog.doc,
          date: latestLog.date || new Date().toISOString(),
          count: latestLog.count,
          hp: latestLog.hp,
          positions: latestLog.positions || [],
          addedNew: latestLog.addedNew || false,
          notes: latestLog.notes || '',
          sopMet: (latestLog.count || 0) >= recommended,
          recommended,
          source: 'pond_detail',
        }).save();
      }
    }

    res.json(updated);
  } catch (e: any) { res.status(400).json({ error: e.message }); }
});


// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—
//  ROI ENTRIES                   â•‘
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

farmer.get('/user/:userId/roi-entries', authenticate, requireSelf, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return dbOffline(res);
    const filter: any = { userId: req.params.userId };
    if (req.query.pondId) filter.pondId = req.query.pondId;
    const entries = await ROIEntryMongo.find(filter).sort({ createdAt: -1 }).limit(200);
    res.json(entries);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

farmer.post('/roi-entries', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const data = { ...req.body, userId: req.user.id };
    if (mongoose.connection.readyState !== 1) return dbOffline(res);
    const entry = await new ROIEntryMongo(data).save();
    res.json(entry);
  } catch (e: any) { res.status(400).json({ error: e.message }); }
});

farmer.delete('/roi-entries/:id', authenticate, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return dbOffline(res);
    await ROIEntryMongo.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (e: any) { res.status(400).json({ error: e.message }); }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—
//  NOTIFICATION HISTORY          â•‘
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

farmer.get('/user/:userId/notifications', authenticate, requireSelf, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return dbOffline(res);
    const logs = await NotificationLogMongo.find({ userId: req.params.userId }).sort({ createdAt: -1 }).limit(100);
    res.json(logs);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

farmer.post('/notifications', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const data = { ...req.body, userId: req.user.id };
    if (mongoose.connection.readyState !== 1) return dbOffline(res);
    const log = await new NotificationLogMongo(data).save();
    res.json(log);
  } catch (e: any) { res.status(400).json({ error: e.message }); }
});

farmer.patch('/notifications/mark-read', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return dbOffline(res);
    await NotificationLogMongo.updateMany({ userId: req.user.id, isRead: false }, { isRead: true });
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—
//  AERATOR LOGS                  â•‘
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

farmer.get('/user/:userId/aerator-logs', authenticate, requireSelf, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return dbOffline(res);
    const filter: any = { userId: req.params.userId };
    if (req.query.pondId) filter.pondId = req.query.pondId;
    const logs = await AeratorLogMongo.find(filter).sort({ createdAt: -1 }).limit(200);
    res.json(logs);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

farmer.delete('/aerator-logs/:id', authenticate, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return dbOffline(res);
    await AeratorLogMongo.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (e: any) { res.status(400).json({ error: e.message }); }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—
//  WATER LOGS                    â•‘
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

farmer.get('/user/:userId/water-logs', authenticate, requireSelf, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return dbOffline(res);
    const filter: any = { userId: req.params.userId };
    if (req.query.pondId) filter.pondId = req.query.pondId;
    const logs = await WaterLogMongo.find(filter).sort({ createdAt: -1 }).limit(500);
    res.json(logs);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

farmer.post('/water-logs', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const data = { ...req.body, userId: req.user.id };
    if (mongoose.connection.readyState !== 1) return dbOffline(res);
    // Upsert: one record per pond per day â€” prevents duplicate entries
    const result = await WaterLogMongo.findOneAndUpdate(
      { userId: req.user.id, pondId: data.pondId, date: data.date },
      { $set: data },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json(result);
  } catch (e: any) { res.status(400).json({ error: e.message }); }
});

farmer.delete('/water-logs/:id', authenticate, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return dbOffline(res);
    await WaterLogMongo.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (e: any) { res.status(400).json({ error: e.message }); }
});;

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—
//  HARVEST REQUESTS (MARKET)     â•‘
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

farmer.get('/harvest-requests', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return dbOffline(res);

    let query = {};
    if (req.user.role === 'farmer') {
      query = { userId: req.user.id };
    } else if (req.user.role === 'provider') {
      // For now, providers see all pending or their accepted ones
      query = { $or: [{ status: 'pending' }, { providerId: req.user.id }] };
    }

    const requests = await HarvestRequest.find(query).sort({ createdAt: -1 });
    res.json(requests);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

farmer.post('/harvest-requests', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const data = { ...req.body, userId: req.user.id, status: 'pending' };

    if (mongoose.connection.readyState !== 1) return dbOffline(res);

    const request = await new HarvestRequest(data).save();

    // BROADCAST LOGIC: Notify nearby providers (within 150km)
    // In a real app, we would use $near sphere or a geo-spatial query
    // For now, we broadcast to all active providers as a simulation
    const nearbyProviders = await UserMongo.find({
      role: 'provider',
      // location: { $in: ['Bhimavaram', 'Nellore', 'Vizag'] } // Example geo-fence
    });

    console.log(`[Market Broadcast] Notifying ${nearbyProviders.length} providers within 150km about new Harvest Request: ${request._id}`);

    // Logic to send push notifications to these providers would go here
    // nearbyProviders.forEach(p => sendPushNotification(p.fcmToken, ...))

    res.json(request);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

farmer.put('/harvest-requests/:id', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    if (req.user.role === 'provider' && !updates.providerId) {
      updates.providerId = req.user.id;
    }

    if (mongoose.connection.readyState !== 1) return dbOffline(res);

    const updated = await HarvestRequest.findByIdAndUpdate(id, updates, { new: true });
    res.json(updated);
    // NOTE: FCM push is sent by the client via POST /api/push/harvest-update
    // Do NOT send FCM here â€” that would cause every status change to notify twice.
  } catch (e) { res.status(400).json({ error: e.message }); }
});


// POST a new message to a harvest request chat
farmer.post('/harvest-requests/:id/messages', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const { message, proposedPrice } = req.body;
    const newMsg = {
      senderId: req.user.id,
      senderName: req.user.name || 'User',
      senderRole: req.user.role || 'farmer',
      message,
      proposedPrice: proposedPrice || null,
      timestamp: new Date()
    };

    if (mongoose.connection.readyState !== 1) return dbOffline(res);

    const updated = await HarvestRequest.findByIdAndUpdate(
      id,
      { $push: { chatMessages: newMsg } },
      { new: true }
    );
    const lastMsg = updated?.chatMessages?.slice(-1)[0];
    res.json(lastMsg);
  } catch (e) { res.status(400).json({ error: (e as Error).message }); }
});

// GET all messages for a harvest request
farmer.get('/harvest-requests/:id/messages', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;

    if (mongoose.connection.readyState !== 1) return dbOffline(res);

    const request = await HarvestRequest.findById(id).select('chatMessages');
    res.json(request?.chatMessages || []);
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});


// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—
//  SOP LOGS                      â•‘
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

farmer.get('/user/:userId/sop-logs', authenticate, requireSelf, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return dbOffline(res);
    const filter: any = { userId: req.params.userId };
    if (req.query.pondId) filter.pondId = req.query.pondId;
    const logs = await SOPLogMongo.find(filter).sort({ createdAt: -1 }).limit(500);
    res.json(logs);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

farmer.post('/sop-logs', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const data = { ...req.body, userId: req.user.id };
    if (mongoose.connection.readyState !== 1) return dbOffline(res);
    res.json(await new SOPLogMongo(data).save());
  } catch (e: any) { res.status(400).json({ error: e.message }); }
});

farmer.delete('/sop-logs/:id', authenticate, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return dbOffline(res);
    await SOPLogMongo.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (e: any) { res.status(400).json({ error: e.message }); }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—
//  EXPENSES                      â•‘
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

farmer.get('/user/:userId/expenses', authenticate, requireSelf, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return dbOffline(res);
    const expenses = await ExpenseMongo.find({ userId: req.params.userId });
    res.json(expenses);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

farmer.post('/expenses', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const data = { ...req.body, userId: req.user.id };
    if (mongoose.connection.readyState !== 1) return dbOffline(res);
    res.json(await new ExpenseMongo(data).save());
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—
//  FEED LOGS                     â•‘
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

farmer.get('/user/:userId/feed-logs', authenticate, requireSelf, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return dbOffline(res);
    const filter: any = { userId: req.params.userId };
    if (req.query.pondId) filter.pondId = req.query.pondId;
    const logs = await FeedLogMongo.find(filter).sort({ createdAt: -1 }).limit(500);
    res.json(logs);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

farmer.post('/feed-logs', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const data = { ...req.body, userId: req.user.id };
    if (mongoose.connection.readyState !== 1) return dbOffline(res);
    res.json(await new FeedLogMongo(data).save());
  } catch (e: any) { res.status(400).json({ error: e.message }); }
});

farmer.delete('/feed-logs/:id', authenticate, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return dbOffline(res);
    await FeedLogMongo.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (e: any) { res.status(400).json({ error: e.message }); }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—
//  MEDICINE LOGS                 â•‘
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

farmer.get('/user/:userId/medicine-logs', authenticate, requireSelf, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return dbOffline(res);
    const filter: any = { userId: req.params.userId };
    if (req.query.pondId) filter.pondId = req.query.pondId;
    const logs = await MedicineLogMongo.find(filter).sort({ createdAt: -1 }).limit(500);
    res.json(logs);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

farmer.post('/medicine-logs', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const data = { ...req.body, userId: req.user.id };
    if (mongoose.connection.readyState !== 1) return dbOffline(res);
    res.json(await new MedicineLogMongo(data).save());
  } catch (e: any) { res.status(400).json({ error: e.message }); }
});

farmer.delete('/medicine-logs/:id', authenticate, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return dbOffline(res);
    await MedicineLogMongo.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (e: any) { res.status(400).json({ error: e.message }); }
});

// â”€â”€â”€ AI Routes (Gemini runs server-side â€” key never exposed to client) â”€â”€â”€â”€â”€â”€â”€â”€â”€
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
const GEMINI_MODEL = 'gemini-2.5-flash';

// â”€â”€ Shared AI error normaliser â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const normaliseAIError = (e: any): { status: number; body: object } => {
  const msg: string = e?.message || JSON.stringify(e) || '';
  // 404 â€” model deprecated / not found
  if (e?.status === 404 || msg.includes('NOT_FOUND') || msg.includes('no longer available') || msg.includes('is not found')) {
    return { status: 503, body: { error: 'AI model unavailable. The server is being updated â€” please try again shortly.' } };
  }
  // 429 / RESOURCE_EXHAUSTED â€” quota exceeded
  if (e?.status === 429 || msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota')) {
    // Try to extract retryDelay from error details
    let retryAfter = 60;
    try {
      const parsed = JSON.parse(msg.substring(msg.indexOf('{')));
      const retryInfo = parsed?.error?.details?.find((d: any) => d['@type']?.includes('RetryInfo'));
      if (retryInfo?.retryDelay) retryAfter = parseInt(retryInfo.retryDelay);
    } catch { /* ignore */ }
    return {
      status: 429, body: {
        error: 'AI quota exhausted',
        message: `You have exceeded the Gemini API free-tier daily limit. Please wait ${retryAfter} seconds and try again, or upgrade your Google AI plan.`,
        retryAfterSeconds: retryAfter,
        code: 'QUOTA_EXCEEDED',
      }
    };
  }
  // 503 / UNAVAILABLE
  if (msg.includes('503') || msg.includes('UNAVAILABLE') || msg.includes('overloaded')) {
    return { status: 503, body: { error: 'AI server overloaded. Please retry in 30 seconds.' } };
  }
  return { status: 500, body: { error: msg || 'AI analysis failed.' } };
};

// â”€â”€ Disease Detection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
farmer.post('/ai/analyze-health', authenticate, async (req: any, res: any) => {
  try {
    if (!process.env.GEMINI_API_KEY) return res.status(503).json({ error: 'AI service not configured on server.' });
    const { base64Image, language = 'English' } = req.body;
    if (!base64Image) return res.status(400).json({ error: 'base64Image is required' });

    const mimeType = base64Image.startsWith('data:') ? base64Image.split(';')[0].split(':')[1] : 'image/jpeg';
    const data = base64Image.includes(',') ? base64Image.split(',')[1] : base64Image;

    const prompt = `You are a certified aquaculture pathologist with 20 years of shrimp disease diagnosis experience.
Analyze this shrimp specimen photo carefully. Return a precise diagnosis using ONLY the visual evidence visible in the image.

1. HEALTHY SHRIMP: Full dark-brown/orange gut line, clear body, normal opacity â†’ disease: "Healthy Shrimp", severity: "Safe"
2. WHITE SPOT DISEASE (WSSV): White calcified spots on shell, reddish body â†’ severity: "Critical"
3. EARLY MORTALITY SYNDROME (EMS/AHPND): Pale shrunken hepatopancreas, empty gut â†’ severity: "Critical"
4. BLACK GILL DISEASE: Dark brown/black gills â†’ severity: "Moderate"
5. WHITE GUT DISEASE (WGD): White gut line, white fecal strings â†’ severity: "Medium"
6. RUNNING MORTALITY SYNDROME (RMS): Soft wrinkled carapace, no spots â†’ severity: "High"
7. EHP: Stunted growth, soft carapace â†’ severity: "High"
8. VIBRIOSIS: Reddish/black necrotic legs/tail, luminescent â†’ severity: "High"
9. IHHNV: Bent rostrum, deformed body â†’ severity: "Moderate"
10. SHELL DISEASE: Black spots on carapace â†’ severity: "Low"
11. FOULING: Fuzzy coating on body â†’ severity: "Low"

RULES: If no shrimp visible â†’ shrimpObserved: false. If blurry â†’ confidence: 0, disease: "Clear Photo Required".
Translate all text values to: ${language}

Return ONLY this JSON (no markdown):
{"shrimpObserved":true,"notObservedReason":"","disease":"string","confidence":number,"severity":"Safe|Low|Medium|Moderate|High|Critical|N/A","affectedPart":"string","reasoning":"string","action":"string"}`;

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ parts: [{ inlineData: { data, mimeType } }, { text: prompt }] }],
      config: { responseMimeType: 'application/json' },
    });

    const text = response.text?.trim() || '';
    const jsonStr = text.startsWith('```') ? text.replace(/^```json?/, '').replace(/```$/, '').trim() : text;
    res.json(JSON.parse(jsonStr));
  } catch (e: any) {
    console.error('[AI-Health Error]', e?.status, e?.message?.substring(0, 120));
    const { status, body } = normaliseAIError(e);
    res.status(status).json(body);
  }
});

// â”€â”€ Water Test Scanner â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
farmer.post('/ai/analyze-water', authenticate, async (req: any, res: any) => {
  try {
    if (!process.env.GEMINI_API_KEY) return res.status(503).json({ error: 'AI service not configured on server.' });
    const { base64Image } = req.body;
    if (!base64Image) return res.status(400).json({ error: 'base64Image is required' });

    const mimeType = base64Image.startsWith('data:') ? base64Image.split(';')[0].split(':')[1] : 'image/jpeg';
    const data = base64Image.includes(',') ? base64Image.split(',')[1] : base64Image;

    const prompt = `You are an expert aquaculture water quality analyst.
Analyze this image â€” it may show pond water color, test kits, strips, or meters.

Water colors: LIGHT_GREEN=healthy, DARK_GREEN=over-bloom, BROWN=diatoms/organic, BLACK=toxic, BLUE_GREEN=cyanobacteria, CLEAR=no plankton, MURKY_YELLOW=turbidity, REDDISH=iron/flagellate.
Safe ranges (L. vannamei): pH 7.5â€“8.5, DO >5 mg/L, NH3 <0.1 mg/L, Salinity 10â€“25 ppt, Temp 23â€“31Â°C.

If not pond water or test equipment â†’ imageValid: false.
Return ONLY valid JSON:
{"detectedEquipment":"string","confidence":number,"overallStatus":"excellent|good|warning|critical","summary":"string","urgentAction":"string","ph":{"value":0,"raw":"string","status":"string"},"do_":{"value":0,"raw":"string","status":"string"},"ammonia":{"value":0,"raw":"string","status":"string"},"salinity":{"value":0,"raw":"string","status":"string"},"temperature":{"value":0,"raw":"string","status":"string"},"waterColor":{"detected":"string","label":"string","hex":"string","meaning":"string","status":"string"},"problems":[],"diseaseRisks":[],"imageValid":true,"notDetectedReason":"","recommendations":[]}`;

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ parts: [{ inlineData: { data, mimeType } }, { text: prompt }] }],
      config: { responseMimeType: 'application/json' },
    });

    const text = response.text?.trim() || '';
    const jsonStr = text.startsWith('```') ? text.replace(/^```json?/, '').replace(/```$/, '').trim() : text;
    res.json(JSON.parse(jsonStr));
  } catch (e: any) {
    console.error('[AI-Water Error]', e?.status, e?.message?.substring(0, 120));
    const { status, body } = normaliseAIError(e);
    res.status(status).json(body);
  }
});

// â”€â”€ Live Stream Frame Analysis â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
farmer.post('/ai/analyze-live', authenticate, async (req: any, res: any) => {
  try {
    if (!process.env.GEMINI_API_KEY) return res.status(503).json({ error: 'AI service not configured.' });
    const { base64Image } = req.body;
    if (!base64Image) return res.status(400).json({ error: 'base64Image is required' });

    const mimeType = base64Image.startsWith('data:') ? base64Image.split(';')[0].split(':')[1] : 'image/jpeg';
    const data = base64Image.includes(',') ? base64Image.split(',')[1] : base64Image;

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ parts: [{ inlineData: { data, mimeType } }, { text: 'Analyze these shrimp post-larvae. Return ONLY JSON: {"activity":number,"health":number,"count":number}' }] }],
      config: { responseMimeType: 'application/json' },
    });

    const text = response.text?.trim() || '';
    const jsonStr = text.startsWith('```') ? text.replace(/^```json?/, '').replace(/```$/, '').trim() : text;
    res.json(JSON.parse(jsonStr));
  } catch (e: any) {
    console.error('[AI-Live Error]', e.message);
    res.json({ activity: 0, health: 0, count: 0 });
  }
});


// â”€â”€â”€ GET /api/admin/me â€” current admin's own profile (from adminusers table) â”€â”€
adminApi.get('/me', authenticate, requireAnyAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return dbOffline(res);
    const admin = await AdminUserMongo.findById(req.user.id, '-password');
    if (!admin) return res.status(404).json({ error: 'Admin account not found' });
    res.json(admin);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// â”€â”€â”€ GET /api/admin/users â€” all users (farmers + providers) in User table â”€â”€â”€â”€â”€
adminApi.get('/users', authenticate, requireAnyAdmin, async (_req, res) => {
  try {
    const users = await UserMongo.find({}, '-password');
    res.json(users);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  ADMIN STAFF MANAGEMENT  (adminusers collection)                            
//  Super Admin only for create/update/delete. Any admin can list.             
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// GET /api/admin/staff â€” list all admin staff
adminApi.get('/staff', authenticate, requireAnyAdmin, async (_req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return dbOffline(res);
    const staff = await AdminUserMongo.find({}, '-password').sort({ createdAt: -1 });
    res.json(staff);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/staff â€” create new admin user (super_admin only)
adminApi.post('/staff', authenticate, requireSuperAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return dbOffline(res);
    const { name, phoneNumber, email, password, role, location } = req.body;
    if (!name || !phoneNumber || !password || !role)
      return res.status(400).json({ error: 'name, phoneNumber, password and role are required' });

    const existing = await AdminUserMongo.findOne({ phoneNumber: phoneNumber.replace(/\D/g, '').slice(-10) });
    if (existing) return res.status(409).json({ error: 'An admin with this phone number already exists' });

    const hash = await bcrypt.hash(password, 12);
    const newAdmin = await new AdminUserMongo({
      name,
      phoneNumber: phoneNumber.replace(/\D/g, '').slice(-10),
      email,
      password: hash,
      role,
      location,
      isActive: true,
      createdBy: req.user.id,
    }).save();

    const { password: _, ...safeAdmin } = newAdmin.toObject();
    console.log(`[AdminStaff] Created ${role} account for ${name} by ${req.user.id}`);
    res.status(201).json(safeAdmin);
  } catch (e: any) { res.status(400).json({ error: e.message }); }
});

// PATCH /api/admin/staff/:id â€” update role / status (super_admin only)
adminApi.patch('/staff/:id', authenticate, requireSuperAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return dbOffline(res);
    const { role, isActive, name, email, location } = req.body;
    const updates: any = {};
    if (role !== undefined) updates.role = role;
    if (isActive !== undefined) updates.isActive = isActive;
    if (name !== undefined) updates.name = name;
    if (email !== undefined) updates.email = email;
    if (location !== undefined) updates.location = location;

    const updated = await AdminUserMongo.findByIdAndUpdate(req.params.id, updates, { new: true, select: '-password' });
    if (!updated) return res.status(404).json({ error: 'Admin user not found' });
    res.json(updated);
  } catch (e: any) { res.status(400).json({ error: e.message }); }
});

// DELETE /api/admin/staff/:id â€” remove admin account (super_admin only)
adminApi.delete('/staff/:id', authenticate, requireSuperAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return dbOffline(res);
    if (req.params.id === req.user.id)
      return res.status(400).json({ error: 'You cannot delete your own admin account' });
    const deleted = await AdminUserMongo.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Admin user not found' });
    res.json({ success: true, message: `Admin account for ${deleted.name} removed` });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/admin/staff/:id/password â€” reset another admin's password (super_admin only)
adminApi.patch('/staff/:id/password', authenticate, requireSuperAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return dbOffline(res);
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6)
      return res.status(400).json({ error: 'newPassword must be at least 6 characters' });
    const hash = await bcrypt.hash(newPassword, 12);
    const updated = await AdminUserMongo.findByIdAndUpdate(req.params.id, { password: hash }, { new: true, select: '-password' });
    if (!updated) return res.status(404).json({ error: 'Admin user not found' });
    res.json({ success: true, message: `Password reset for ${updated.name}` });
  } catch (e: any) { res.status(400).json({ error: e.message }); }
});


// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—
//  ADMIN INTELLIGENCE ENDPOINTS                                                 â•‘
//  All require: Authorization: Bearer <admin_jwt>                               â•‘
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// â”€â”€â”€ GET /api/admin/farmers â€” all farmers with subscription info â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
adminApi.get('/farmers', authenticate, requireAnyAdmin, async (_req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return dbOffline(res);
    const farmers = await UserMongo.find({ role: 'farmer' }, '-password').sort({ createdAt: -1 });
    const subs = await SubscriptionMongo.find({});
    const subMap = Object.fromEntries(subs.map(s => [s.userId, s]));
    const result = farmers.map(f => {
      const fObj = f.toObject();
      return { ...fObj, subscription: subMap[String(f._id)] || null };
    });
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// â”€â”€â”€ GET /api/admin/ponds â€” all ponds across all farmers, with computed intel â”€
adminApi.get('/ponds', authenticate, requireAnyAdmin, async (_req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return dbOffline(res);
    const ponds = await PondMongo.find({}).sort({ createdAt: -1 });
    const now = Date.now();

    const enriched = await Promise.all(ponds.map(async (pond: any) => {
      const pObj = pond.toObject();
      const doc = pond.stockingDate
        ? Math.floor((now - new Date(pond.stockingDate).getTime()) / 86400000)
        : 0;

      // Fetch last 3 water logs for quick health summary
      const recentWater = await WaterLogMongo.find({ pondId: String(pond._id) })
        .sort({ createdAt: -1 }).limit(3).lean();

      // Fetch last 7 feed logs for FCR/consumption trend
      const recentFeed = await FeedLogMongo.find({ pondId: String(pond._id) })
        .sort({ createdAt: -1 }).limit(7).lean();

      const totalFeedKg = recentFeed.reduce((s: number, f: any) => s + (f.quantity || 0), 0);
      const lastWater = recentWater[0] || null;

      // Auto-detect alerts
      const alerts: string[] = [];
      if (lastWater) {
        if ((lastWater as any).do < 4) alerts.push('CRITICAL_LOW_DO');
        if ((lastWater as any).ph < 7 || (lastWater as any).ph > 9) alerts.push('PH_OUT_OF_RANGE');
        if ((lastWater as any).ammonia > 0.5) alerts.push('HIGH_AMMONIA');
        if ((lastWater as any).mortality > 100) alerts.push('HIGH_MORTALITY');
      }
      if (doc > 83 && pond.status === 'active') alerts.push('HARVEST_READY');
      if (doc > 45 && doc < 55) alerts.push('PEAK_WSSV_RISK');

      // Stage label
      const stage = doc <= 20 ? 'Nursery' : doc <= 40 ? 'Early Growth' : doc <= 60 ? 'Mid Growth' : doc <= 80 ? 'Pre-Harvest' : 'Harvest';

      return {
        ...pObj,
        doc,
        stage,
        alerts,
        lastWaterLog: lastWater,
        feedLast7Days: totalFeedKg,
        feedLogCount: recentFeed.length,
        farmerName: null, // filled by join below
      };
    }));

    // Join farmer names
    const farmerIds = [...new Set(enriched.map(p => p.userId))];
    const farmers = await UserMongo.find({ _id: { $in: farmerIds } }, 'name phoneNumber location').lean();
    const farmerMap = Object.fromEntries(farmers.map(f => [String(f._id), f]));
    const final = enriched.map(p => ({
      ...p,
      farmer: farmerMap[p.userId] || null,
    }));

    res.json(final);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// â”€â”€â”€ GET /api/admin/intelligence â€” aggregated business intelligence dashboard â”€
adminApi.get('/intelligence', authenticate, requireAnyAdmin, async (_req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return dbOffline(res);

    const [farmers, ponds, feedLogs, waterLogs, harvestReqs, roiEntries, shopOrders, subs] = await Promise.all([
      UserMongo.find({ role: 'farmer' }, '_id name location subscriptionStatus createdAt').lean(),
      PondMongo.find({}).lean(),
      FeedLogMongo.find({ date: { $gte: new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0] } }).lean(),
      WaterLogMongo.find({ date: { $gte: new Date(Date.now() - 3 * 86400000).toISOString().split('T')[0] } }).lean(),
      HarvestRequest.find({}).lean(),
      ROIEntryMongo.find({}).lean(),
      ((): any => mongoose.models['ShopOrder'] ?? mongoose.model('ShopOrder', new mongoose.Schema({}, { strict: false })))().find({}).lean(),
      SubscriptionMongo.find({}).lean(),
    ]);

    const now = Date.now();
    const activePonds = ponds.filter((p: any) => p.status === 'active');
    const harvestedPonds = ponds.filter((p: any) => p.status === 'harvested');

    // Compute DOC for each active pond
    const pondWithDoc = activePonds.map((p: any) => ({
      ...p,
      doc: p.stockingDate ? Math.floor((now - new Date(p.stockingDate).getTime()) / 86400000) : 0,
    }));

    // Ponds needing harvest (DOC > 83)
    const harvestReady = pondWithDoc.filter((p: any) => p.doc > 83);
    // Ponds in critical window (WSSV risk DOC 40-55)
    const criticalRiskPonds = pondWithDoc.filter((p: any) => p.doc >= 40 && p.doc <= 55);
    // Ponds with low DO alerts
    const lowDoPonds = waterLogs.filter((w: any) => (w as any).do < 4 || (w as any).do < 4);

    // Feed demand in next 7 days (farmers with active ponds consuming high feed)
    const highFeedFarmers = feedLogs.reduce((acc: Record<string, number>, log: any) => {
      acc[log.userId] = (acc[log.userId] || 0) + (log.quantity || 0);
      return acc;
    }, {});

    // Revenue from ROI entries
    const totalRevenue = roiEntries.reduce((s: number, r: any) => s + (r.totalRevenue || 0), 0);
    const totalProfit = roiEntries.reduce((s: number, r: any) => s + (r.netProfit || 0), 0);
    const avgROI = roiEntries.length ? roiEntries.reduce((s: number, r: any) => s + (r.roi || 0), 0) / roiEntries.length : 0;

    // Subscription breakdown
    const subBreakdown = subs.reduce((acc: Record<string, number>, s: any) => {
      acc[s.planName] = (acc[s.planName] || 0) + 1;
      return acc;
    }, {});

    // Stage distribution
    const stageDistribution = pondWithDoc.reduce((acc: Record<string, number>, p: any) => {
      const stage = p.doc <= 20 ? 'Nursery' : p.doc <= 40 ? 'Early Growth' : p.doc <= 60 ? 'Mid Growth' : p.doc <= 80 ? 'Pre-Harvest' : 'Harvest Ready';
      acc[stage] = (acc[stage] || 0) + 1;
      return acc;
    }, {});

    // Pending harvest requests
    const pendingHarvests = harvestReqs.filter((h: any) => h.status === 'pending');
    const completedHarvests = harvestReqs.filter((h: any) => h.status === 'completed' || h.status === 'paid');
    const totalHarvestBiomass = completedHarvests.reduce((s: number, h: any) => s + (h.finalWeight || h.biomass || 0), 0);

    // Shop orders
    const pendingShopOrders = (shopOrders as any[]).filter((o: any) => ['assigned', 'confirmed'].includes(o.status));

    // Alerts severity list
    const systemAlerts: { type: string; severity: string; message: string; pondId?: string; farmerId?: string }[] = [];
    harvestReady.forEach((p: any) => systemAlerts.push({ type: 'HARVEST_READY', severity: 'HIGH', message: `Pond "${p.name}" is DOC ${p.doc} â€” harvest window open`, pondId: String(p._id), farmerId: p.userId }));
    criticalRiskPonds.forEach((p: any) => systemAlerts.push({ type: 'WSSV_RISK', severity: 'CRITICAL', message: `Pond "${p.name}" in peak WSSV window (DOC ${p.doc})`, pondId: String(p._id), farmerId: p.userId }));

    res.json({
      summary: {
        totalFarmers: farmers.length,
        activePonds: activePonds.length,
        harvestedPonds: harvestedPonds.length,
        totalPonds: ponds.length,
        harvestReadyCount: harvestReady.length,
        criticalRiskCount: criticalRiskPonds.length,
        pendingHarvestRequests: pendingHarvests.length,
        pendingShopOrders: pendingShopOrders.length,
        totalFeedKgLast7Days: Object.values(highFeedFarmers).reduce((s: number, v) => s + (v as number), 0),
        totalRevenue,
        totalProfit,
        avgROI: Math.round(avgROI * 10) / 10,
        totalHarvestBiomassKg: totalHarvestBiomass,
      },
      stageDistribution,
      subscriptionBreakdown: subBreakdown,
      systemAlerts: systemAlerts.slice(0, 50),
      harvestReady: harvestReady.slice(0, 20),
      criticalRiskPonds: criticalRiskPonds.slice(0, 20),
      pendingHarvestRequests: pendingHarvests.slice(0, 20),
      topFeedConsumers: Object.entries(highFeedFarmers)
        .sort(([, a], [, b]) => (b as number) - (a as number))
        .slice(0, 10)
        .map(([id, kg]) => ({ farmerId: id, feedKg: kg })),
      recentROI: roiEntries.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 10),
    });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// â”€â”€â”€ GET /api/admin/water-alerts â€” cross-pond water quality alerts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
adminApi.get('/water-alerts', authenticate, requireAnyAdmin, async (_req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return dbOffline(res);
    const cutoff = new Date(Date.now() - 2 * 86400000).toISOString().split('T')[0];
    const logs = await WaterLogMongo.find({ date: { $gte: cutoff } }).sort({ createdAt: -1 }).lean();
    const alerts = logs.filter((l: any) =>
      (l as any).do < 4 || (l as any).ph < 7 || (l as any).ph > 9 ||
      (l as any).ammonia > 0.5 || (l as any).mortality > 50
    );
    // Join pond names
    const pondIds = [...new Set(alerts.map((a: any) => a.pondId))];
    const ponds = await PondMongo.find({ _id: { $in: pondIds } }, 'name userId').lean();
    const pondMap = Object.fromEntries(ponds.map(p => [String(p._id), p]));
    const enriched = alerts.map((a: any) => ({ ...a, pond: pondMap[(a as any).pondId] }));
    res.json(enriched);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// â”€â”€â”€ GET /api/admin/shop-orders â€” all shop orders with farmer info â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
adminApi.get('/shop-orders', authenticate, requireAnyAdmin, async (_req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return dbOffline(res);
    const ShopOrderModel = mongoose.models['ShopOrder'];
    if (!ShopOrderModel) return res.json([]);
    const orders = await ShopOrderModel.find({}).sort({ createdAt: -1 }).limit(200).lean();
    res.json(orders);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// â”€â”€â”€ GET /api/admin/all-orders â€” UNIFIED view: ShopOrders + ProviderOrders â”€â”€â”€â”€
// Both collections now live in the same `aquagrow` DB so this is a simple
// fan-out query â€” no cross-DB joins needed.
adminApi.get('/all-orders', authenticate, requireAnyAdmin, async (_req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return dbOffline(res);

    const ShopOrderModel = mongoose.models['ShopOrder'];
    const ProviderOrderModel = mongoose.models['ProviderOrder'];

    const [shopOrders, providerOrders] = await Promise.all([
      ShopOrderModel ? ShopOrderModel.find({}).sort({ createdAt: -1 }).limit(500).lean() : [],
      ProviderOrderModel ? ProviderOrderModel.find({}).sort({ createdAt: -1 }).limit(500).lean() : [],
    ]);

    // Tag each order with its source so the admin UI can distinguish them
    const tagged = [
      ...(shopOrders as any[]).map(o => ({ ...o, _source: 'shop' })),
      ...(providerOrders as any[]).map(o => ({ ...o, _source: 'provider' })),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    res.json(tagged);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// â”€â”€â”€ GET /api/admin/providers â€” all providers from the unified DB â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
adminApi.get('/providers', authenticate, requireAnyAdmin, async (_req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return dbOffline(res);
    // Providers register in the users collection with role:'provider'
    const providers = await UserMongo.find({ role: 'provider' }, '-password').sort({ createdAt: -1 }).lean();
    // Enrich with their extended profile if available
    const ProviderProfileModel = mongoose.models['ProviderProfile'];
    if (ProviderProfileModel) {
      const profiles = await ProviderProfileModel.find({}).lean();
      const profileMap = Object.fromEntries((profiles as any[]).map(p => [p.userId, p]));
      const enriched = providers.map(p => ({ ...p, profile: profileMap[String((p as any)._id)] || null }));
      return res.json(enriched);
    }
    res.json(providers);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// â”€â”€â”€ GET /api/admin/roi â€” all ROI/harvest entries for revenue analytics â”€â”€â”€â”€â”€â”€â”€â”€
adminApi.get('/roi', authenticate, requireAnyAdmin, async (_req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return dbOffline(res);
    const entries = await ROIEntryMongo.find({}).sort({ createdAt: -1 }).limit(500).lean();
    // Join farmer names
    const farmerIds = [...new Set(entries.map((e: any) => e.userId))];
    const farmers = await UserMongo.find({ _id: { $in: farmerIds } }, 'name location').lean();
    const fMap = Object.fromEntries(farmers.map(f => [String(f._id), f]));
    const result = entries.map((e: any) => ({ ...e, farmer: fMap[e.userId] || null }));
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// â”€â”€â”€ GET /api/admin/subscriptions â€” all active subscriptions with farmer info â”€
adminApi.get('/subscriptions', authenticate, requireAnyAdmin, async (_req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return dbOffline(res);
    const subs = await SubscriptionMongo.find({}).sort({ createdAt: -1 }).lean();
    const userIds = [...new Set((subs as any[]).map(s => s.userId))];
    const users = await UserMongo.find({ _id: { $in: userIds } }, 'name phoneNumber location subscriptionStatus').lean();
    const uMap = Object.fromEntries(users.map(u => [String(u._id), u]));
    const result = (subs as any[]).map(s => ({ ...s, farmer: uMap[s.userId] || null }));
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// â”€â”€â”€ GET /api/admin/expenses â€” all farmer expenses aggregated â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
adminApi.get('/expenses', authenticate, requireAnyAdmin, async (_req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return dbOffline(res);
    const expenses = await ExpenseMongo.find({}).sort({ createdAt: -1 }).limit(500).lean();
    const userIds = [...new Set((expenses as any[]).map(e => e.userId))];
    const users = await UserMongo.find({ _id: { $in: userIds } }, 'name phoneNumber location').lean();
    const uMap = Object.fromEntries(users.map(u => [String(u._id), u]));
    const pondIds = [...new Set((expenses as any[]).map(e => e.pondId).filter(Boolean))];
    const ponds = await PondMongo.find({ _id: { $in: pondIds } }, 'name').lean();
    const pMap = Object.fromEntries(ponds.map(p => [String(p._id), p]));
    const result = (expenses as any[]).map(e => ({
      ...e,
      farmer: uMap[e.userId] || null,
      pond: pMap[e.pondId] || null,
    }));
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// â”€â”€â”€ GET /api/admin/feed-logs â€” all feed logs for admin overview â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
adminApi.get('/feed-logs', authenticate, requireAnyAdmin, async (_req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return dbOffline(res);
    const logs = await FeedLogMongo.find({}).sort({ createdAt: -1 }).limit(500).lean();
    const userIds = [...new Set((logs as any[]).map(l => l.userId))];
    const users = await UserMongo.find({ _id: { $in: userIds } }, 'name phoneNumber').lean();
    const uMap = Object.fromEntries(users.map(u => [String(u._id), u]));
    const pondIds = [...new Set((logs as any[]).map(l => l.pondId).filter(Boolean))];
    const ponds = await PondMongo.find({ _id: { $in: pondIds } }, 'name').lean();
    const pMap = Object.fromEntries(ponds.map(p => [String(p._id), p]));
    const result = (logs as any[]).map(l => ({
      ...l,
      farmer: uMap[l.userId] || null,
      pond: pMap[l.pondId] || null,
    }));
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// â”€â”€â”€ GET /api/admin/medicine-logs â€” all medicine logs for admin overview â”€â”€â”€â”€â”€â”€â”€
adminApi.get('/medicine-logs', authenticate, requireAnyAdmin, async (_req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return dbOffline(res);
    const logs = await MedicineLogMongo.find({}).sort({ createdAt: -1 }).limit(500).lean();
    const userIds = [...new Set((logs as any[]).map(l => l.userId))];
    const users = await UserMongo.find({ _id: { $in: userIds } }, 'name phoneNumber').lean();
    const uMap = Object.fromEntries(users.map(u => [String(u._id), u]));
    const pondIds = [...new Set((logs as any[]).map(l => l.pondId).filter(Boolean))];
    const ponds = await PondMongo.find({ _id: { $in: pondIds } }, 'name').lean();
    const pMap = Object.fromEntries(ponds.map(p => [String(p._id), p]));
    const result = (logs as any[]).map(l => ({
      ...l,
      farmer: uMap[l.userId] || null,
      pond: pMap[l.pondId] || null,
    }));
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// â”€â”€â”€ GET /api/admin/notifications â€” all platform notifications â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
adminApi.get('/notifications', authenticate, requireAnyAdmin, async (_req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return dbOffline(res);
    const notifs = await NotificationLogMongo.find({}).sort({ createdAt: -1 }).limit(300).lean();
    const userIds = [...new Set((notifs as any[]).map(n => n.userId))];
    const users = await UserMongo.find({ _id: { $in: userIds } }, 'name phoneNumber role').lean();
    const uMap = Object.fromEntries(users.map(u => [String(u._id), u]));
    const result = (notifs as any[]).map(n => ({ ...n, farmer: uMap[n.userId] || null }));
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// â”€â”€â”€ GET /api/admin/iot â€” all IoT / aerator logs aggregated â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
adminApi.get('/iot', authenticate, requireAnyAdmin, async (_req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return dbOffline(res);
    const logs = await AeratorLogMongo.find({}).sort({ createdAt: -1 }).limit(500).lean();
    const userIds = [...new Set((logs as any[]).map(l => l.userId))];
    const users = await UserMongo.find({ _id: { $in: userIds } }, 'name phoneNumber').lean();
    const uMap = Object.fromEntries(users.map(u => [String(u._id), u]));
    const pondIds = [...new Set((logs as any[]).map(l => l.pondId).filter(Boolean))];
    const ponds = await PondMongo.find({ _id: { $in: pondIds } }, 'name').lean();
    const pMap = Object.fromEntries(ponds.map(p => [String(p._id), p]));
    const result = (logs as any[]).map(l => ({
      ...l,
      farmer: uMap[l.userId] || null,
      pond: pMap[l.pondId] || null,
    }));
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});


// â”€â”€â”€ FCM Helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const sendFCM = async (token: string, payload: admin.messaging.Message): Promise<boolean> => {
  if (!token) return false;
  if (admin.apps.length > 0) {
    try {
      // Always inject the token into the message â€” callers build the payload
      // without it since the token is looked up separately.
      const msg: admin.messaging.Message = { ...payload, token };
      await admin.messaging().send(msg);
      return true;
    } catch (err: any) {
      console.warn('[FCM-ERROR]', err.message);
      // Auto-clear stale / unregistered tokens so we stop retrying them
      const errCode: string = err.code || err.errorInfo?.code || '';
      const isStale =
        errCode.includes('registration-token-not-registered') ||
        errCode.includes('invalid-registration-token') ||
        errCode.includes('NOT_FOUND') ||
        err.message?.includes('Requested entity was not found');
      if (isStale) {
        try {
          await UserMongo.updateOne({ fcmToken: token }, { $unset: { fcmToken: '' } });
          console.warn(`[FCM-CLEANUP] Removed stale token ...${token.slice(-12)} from DB`);
        } catch (cleanupErr: any) {
          console.warn('[FCM-CLEANUP-ERROR]', cleanupErr.message);
        }
      }
      return false;
    }
  }
  console.log('[SIMULATED-PUSH]', JSON.stringify(payload.notification));
  return false;
};

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—
//  SHOP ORDERS                   â•‘
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// â”€â”€ Schema â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const ShopOrderSchema = new mongoose.Schema({
  farmerId: { type: String, required: true },
  farmerName: { type: String, default: '' },
  farmerPhone: { type: String, default: '' },
  providerId: { type: String, default: null },   // assigned by backend
  providerName: { type: String, default: '' },
  items: [{
    productId: String,
    productName: String,
    unit: String,
    qty: Number,
    unitPrice: Number,
    subtotal: Number,
  }],
  subtotal: { type: Number, default: 0 },
  deliveryFee: { type: Number, default: 0 },
  totalAmount: { type: Number, default: 0 },
  deliveryNote: { type: String, default: '' },
  location: { lat: Number, lng: Number },      // farmer's GPS at order time
  status: { type: String, default: 'assigned', enum: ['assigned', 'confirmed', 'shipped', 'delivered', 'cancelled'] },
  source: { type: String, default: 'aqua_shop' },
}, { timestamps: true });

const ShopOrder = (mongoose.models['ShopOrder'] ?? mongoose.model('ShopOrder', ShopOrderSchema)) as mongoose.Model<any>;

// â”€â”€ Helper: find nearest active provider â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Simple version: picks first available provider. Extend with geo-query when needed.
const assignNearestProvider = async (lat?: number, lng?: number): Promise<{ id: string; name: string } | null> => {
  try {
    const providers = await UserMongo.find({ role: 'provider' }).select('_id name location').limit(20);
    if (!providers.length) return null;
    if (!lat || !lng) return { id: String(providers[0]._id), name: providers[0].name || 'Provider' };

    // Haversine distance sort
    const withDist = providers.map(p => {
      const pLat = (p as any).location?.lat;
      const pLng = (p as any).location?.lng;
      if (!pLat || !pLng) return { p, dist: 99999 };
      const R = 6371;
      const dLat = (pLat - lat) * Math.PI / 180;
      const dLng = (pLng - lng) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat * Math.PI / 180) * Math.cos(pLat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
      return { p, dist: R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) };
    });
    withDist.sort((a, b) => a.dist - b.dist);
    const nearest = withDist[0].p;
    return { id: String(nearest._id), name: nearest.name || 'Provider' };
  } catch { return null; }
};

// â”€â”€ POST /api/shop/orders â€” farmer places order â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
shopOrders.post('/orders', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return dbOffline(res);
    const { farmerId, farmerName, farmerPhone, items, subtotal, deliveryFee, totalAmount, deliveryNote, location, source } = req.body;

    if (!items || items.length === 0) return res.status(400).json({ error: 'Cart is empty' });

    // Find nearest provider based on farmer's GPS location
    const provider = await assignNearestProvider(location?.lat, location?.lng);

    const order = await new ShopOrder({
      farmerId: farmerId || req.user.id,
      farmerName: farmerName || '',
      farmerPhone: farmerPhone || '',
      providerId: provider?.id || null,
      providerName: provider?.name || '',
      items,
      subtotal: subtotal || 0,
      deliveryFee: deliveryFee || 0,
      totalAmount: totalAmount || 0,
      deliveryNote: deliveryNote || '',
      location: location || {},
      source: source || 'aqua_shop',
      status: 'assigned',
    }).save();

    console.log(`[ShopOrder] New order ${order._id} assigned to provider ${provider?.name || 'none'}`);
    res.status(201).json({ orderId: order._id, providerId: provider?.id, providerName: provider?.name, status: 'assigned' });
  } catch (e: any) { res.status(400).json({ error: e.message }); }
});

// â”€â”€ GET /api/shop/orders â€” list orders (role-scoped) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
shopOrders.get('/orders', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return dbOffline(res);
    let filter: any = {};
    if (req.user.role === 'farmer') {
      filter.farmerId = req.user.id;
    } else if (req.user.role === 'provider') {
      // Provider sees: orders assigned to them OR unassigned (so they can claim)
      filter = {
        $or: [
          { providerId: req.user.id },
          { providerId: null },
          { providerId: { $exists: false } },
        ]
      };
    }
    // admin sees everything (no filter)
    const orders = await ShopOrder.find(filter).sort({ createdAt: -1 }).limit(200);
    res.json(orders);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// â”€â”€ PATCH /api/shop/orders/:id/claim â€” provider self-assigns an unassigned order
shopOrders.patch('/orders/:id/claim', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return dbOffline(res);
    if (req.user.role !== 'provider' && !isAdminRole(req.user.role))
      return res.status(403).json({ error: 'Only providers can claim orders' });
    const order = await ShopOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.providerId && order.providerId !== req.user.id)
      return res.status(409).json({ error: 'Order already claimed by another provider' });
    const user = await UserMongo.findById(req.user.id).select('name');
    const updated = await ShopOrder.findByIdAndUpdate(
      req.params.id,
      { providerId: req.user.id, providerName: (user as any)?.name || 'Provider', status: 'confirmed' },
      { new: true }
    );
    console.log(`[ShopOrder] ${req.params.id} claimed by provider ${req.user.id}`);
    res.json(updated);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// â”€â”€ GET /api/shop/orders/:id â€” single order â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
shopOrders.get('/orders/:id', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return dbOffline(res);
    const order = await ShopOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json(order);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// â”€â”€ PATCH /api/shop/orders/:id/status â€” provider/admin updates delivery stage â”€
shopOrders.patch('/orders/:id/status', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return dbOffline(res);
    const { status } = req.body;
    const allowed = ['assigned', 'confirmed', 'shipped', 'delivered', 'cancelled'];
    if (!allowed.includes(status)) return res.status(400).json({ error: `Invalid status. Must be one of: ${allowed.join(', ')}` });

    const order = await ShopOrder.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    console.log(`[ShopOrder] ${order._id} â†’ ${status} by ${req.user.id}`);
    res.json(order);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// â”€â”€ PATCH /api/shop/orders/:id/assign â€” admin reassigns to different provider â”€â”€
shopOrders.patch('/orders/:id/assign', authenticate, requireAnyAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return dbOffline(res);
    const { providerId, providerName } = req.body;
    if (!providerId) return res.status(400).json({ error: 'providerId is required' });
    const order = await ShopOrder.findByIdAndUpdate(req.params.id, { providerId, providerName: providerName || '' }, { new: true });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json(order);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// â”€â”€ Community Image Upload Proxy â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Client sends base64 â†’ server uploads to Firebase Storage â†’ returns public URL.
// This BYPASSES the CORS issue entirely since the upload happens server-to-server.
farmer.post('/community/upload-image', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const { base64Image, channel = 'general', mimeType = 'image/jpeg' } = req.body;
    if (!base64Image) return res.status(400).json({ error: 'base64Image is required' });

    // Strip data URL prefix if present
    const base64Data = base64Image.includes(',') ? base64Image.split(',')[1] : base64Image;
    const buffer = Buffer.from(base64Data, 'base64');

    if (buffer.length > 8 * 1024 * 1024) {
      return res.status(413).json({ error: 'Image too large (max 8 MB)' });
    }

    // Use Firebase Admin Storage to upload
    if (!adminStorage) return res.status(503).json({ error: 'Storage service not configured' });
    const bucket = adminStorage.bucket();
    const ext = mimeType.split('/')[1] || 'jpg';
    const fileName = `community_images/${channel}/${Date.now()}_${req.user.id}.${ext}`;
    const file = bucket.file(fileName);

    await file.save(buffer, {
      metadata: { contentType: mimeType },
      resumable: false,
    });

    // Make the file publicly readable and get the URL
    await file.makePublic();
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;

    res.json({ url: publicUrl });
  } catch (e: any) {
    console.error('[CommunityUpload] Error:', e.message);
    res.status(500).json({ error: e.message || 'Upload failed' });
  }
});

// â”€â”€â”€ Test Push Endpoint (debug only) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// POST /api/push/test  { userId: "..." }
// Sends a real test FCM notification to verify the full pipeline is working.
farmer.post('/push/test', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.body?.userId || req.user?.id;
    if (mongoose.connection.readyState !== 1) return dbOffline(res);

    const user = await UserMongo.findById(userId);
    if (!user?.fcmToken) {
      return res.status(400).json({ ok: false, reason: 'No FCM token registered for this user. Open the app first.' });
    }
    if (admin.apps.length === 0) {
      return res.status(500).json({ ok: false, reason: 'Firebase Admin SDK not initialized. Check FIREBASE_SERVICE_ACCOUNT_KEY env var.' });
    }

    const msg: admin.messaging.Message = {
      token: user.fcmToken,
      notification: {
        title: 'âœ… AquaGrow Test Notification',
        body: `FCM pipeline confirmed working! Token ends in ...${user.fcmToken.slice(-8)}`,
      },
      data: { type: 'test', deepLink: '/dashboard' },
      android: {
        priority: 'high',
        notification: {
          channelId: 'aquagrow-premium',
          icon: 'ic_stat_aquagrow',
          color: '#10B981',
          tag: 'aquagrow-test',
          sound: 'default',
          visibility: 'public' as any,
        },
      },
    };

    const sent = await sendFCM(user.fcmToken, msg);
    console.log(`[TEST-PUSH] ${sent ? 'âœ… Sent' : 'âŒ Failed'} â†’ ${user.name || userId}`);
    res.json({ ok: sent, userId, tokenTail: user.fcmToken.slice(-8), firebaseApps: admin.apps.length });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});


// Used by the push daemon to fetch real weather every 15 min and alert farmers.
const OWM_API_KEY = '02eb92440f84d48b0d5df34e44540cb1';
const OWM_BASE = 'https://api.openweathermap.org/data/2.5';

interface OWMWeatherBrief {
  temp: number; rainPct: number; humidity: number; windKmh: number;
  weatherId: number; location: string; hour: number; conditionCode: string;
}

const fetchWeatherBrief = async (city: string): Promise<OWMWeatherBrief | null> => {
  try {
    const url = `${OWM_BASE}/weather?q=${encodeURIComponent(city)}&appid=${OWM_API_KEY}&units=metric`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const d = await res.json();
    const temp = Math.round(d.main?.temp ?? 0);
    const humidity = d.main?.humidity ?? 0;
    const windKmh = Math.round((d.wind?.speed ?? 0) * 3.6);
    const weatherId = d.weather?.[0]?.id ?? 800;
    let conditionCode = 'sunny';
    if (weatherId >= 200 && weatherId < 300) conditionCode = 'storm';
    else if (weatherId >= 300 && weatherId < 600) conditionCode = 'rain';
    else if (weatherId >= 700 && weatherId < 800) conditionCode = 'fog';
    else if (weatherId > 800) conditionCode = 'cloudy';
    else if (temp >= 36) conditionCode = 'hot';
    const rainPct = conditionCode === 'storm' ? 85 : conditionCode === 'rain' ? 60 : conditionCode === 'cloudy' ? 20 : 5;
    return { temp, rainPct, humidity, windKmh, weatherId, location: `${d.name}, ${d.sys?.country ?? 'IN'}`, hour: new Date().getHours(), conditionCode };
  } catch { return null; }
};

// Build weather alerts for aquaculture from a weather brief
const buildWeatherAlerts = (w: OWMWeatherBrief): { title: string; body: string; aqAction: string; type: 'critical' | 'warning' | 'info'; color: string }[] => {
  const out: { title: string; body: string; aqAction: string; type: 'critical' | 'warning' | 'info'; color: string }[] = [];
  if (w.temp >= 36) out.push({ title: `ðŸŒ¡ï¸ Extreme Heat â€” ${w.temp}Â°C`, body: `High temp at ${w.location} causing DO drop risk. Shrimp metabolism slows above 33Â°C.`, aqAction: 'Skip noon feed (12â€“2 PM). Apply Vitamin C. Add aeration at 3 PM.', type: 'critical', color: '#EF4444' });
  else if (w.temp >= 33) out.push({ title: `ðŸŒ¡ï¸ High Temp â€” ${w.temp}Â°C`, body: `Temperature above optimal range (26â€“30Â°C) at ${w.location}. Increase aeration.`, aqAction: 'Reduce noon feed by 15%. Check DO at 3 PM.', type: 'warning', color: '#F59E0B' });
  if (w.rainPct > 70) out.push({ title: `ðŸŒ§ï¸ Heavy Rain Warning`, body: `Heavy rainfall likely at ${w.location}. Salinity drop risk. Check drainage.`, aqAction: 'Reduce feed 20%. Run all aerators. Check salinity after rain.', type: 'critical', color: '#3B82F6' });
  else if (w.rainPct > 40) out.push({ title: `ðŸŒ¦ï¸ Rain Expected`, body: `Moderate rain at ${w.location}. Monitor pond salinity and DO.`, aqAction: 'Reduce feed 10%. Check DO and pH after rainfall.', type: 'warning', color: '#60A5FA' });
  if (w.windKmh > 40) out.push({ title: `ðŸ’¨ High Wind â€” ${w.windKmh} km/h`, body: `Strong winds at ${w.location} can disturb pond surface and stress shrimp.`, aqAction: 'Reduce feeding in windy slots. Increase aerator coverage.', type: 'warning', color: '#8B5CF6' });
  if (w.hour >= 3 && w.hour <= 6) out.push({ title: `âš ï¸ Pre-Dawn DO Risk Window`, body: `3â€“6 AM critical zone at ${w.location}. Photosynthesis stopped.`, aqAction: 'Ensure all aerators running. Check DO immediately.', type: 'warning', color: '#F97316' });
  if (w.conditionCode === 'storm') out.push({ title: `â›ˆï¸ Storm / Lightning Alert`, body: `Thunderstorm conditions at ${w.location}. Avoid pond-side work. Danger to equipment.`, aqAction: 'Secure aerator cables. Keep farmer away from pond edges during lightning.', type: 'critical', color: '#6366F1' });
  return out;
};

// â”€â”€â”€ WEATHER ALERT PUSH â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// POST /api/push/weather-alert
// Client calls this after fetching OWM data when critical/warning conditions arise.
// Body: { alertTitle, alertBody, aqAction, alertType, location, conditionCode, temp, rainPct }
farmer.post('/push/weather-alert', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const { alertTitle, alertBody, aqAction, alertType, location, conditionCode, temp, rainPct } = req.body;
    const userId = req.user.id;

    if (mongoose.connection.readyState !== 1) return dbOffline(res);
    const user = await UserMongo.findById(userId);
    if (!user?.fcmToken) return res.json({ sent: false, reason: 'No FCM token' });

    const emoji = alertType === 'critical' ? 'ðŸš¨' : alertType === 'warning' ? 'âš ï¸' : 'â„¹ï¸';
    const color = alertType === 'critical' ? '#EF4444' : alertType === 'warning' ? '#F59E0B' : '#10B981';
    const condImg = conditionCode === 'storm'
      ? 'https://aquagrow.onrender.com/assets/push/storm.png'
      : conditionCode === 'rain'
        ? 'https://aquagrow.onrender.com/assets/push/rain.png'
        : conditionCode === 'hot'
          ? 'https://aquagrow.onrender.com/assets/push/hot.png'
          : 'https://aquagrow.onrender.com/assets/push/sunny.png';

    const message: admin.messaging.Message = {
      token: user.fcmToken,
      notification: {
        title: `${emoji} ${alertTitle}`,
        body: alertBody,
        imageUrl: condImg,
      },
      data: {
        type: 'weather_alert',
        alertType: String(alertType || 'info'),
        conditionCode: String(conditionCode || ''),
        location: String(location || ''),
        temp: String(temp ?? ''),
        rainPct: String(rainPct ?? ''),
        aqAction: String(aqAction || ''),
        deepLink: '/weather',
      },
      android: {
        // NOTE: 'normal' priority is NEVER delivered to killed apps on Android.
        // ALWAYS use 'high' so FCM wakes the device regardless of alert severity.
        priority: 'high',
        ttl: 3600000,
        notification: {
          channelId: 'aquagrow-premium',
          color,
          icon: 'ic_stat_aquagrow',
          tag: `weather-${userId}`,
          ticker: `AquaGrow Weather: ${alertTitle}`,
          notificationCount: 1,
          clickAction: 'OPEN_WEATHER_ALERTS',
          sound: 'alert_sound',
          visibility: 'public' as any,
          // BigText expanded view â€” shows full aqAction guidance
          body: `${alertBody}\n\nðŸŒ¾ Action: ${aqAction}`,
          imageUrl: condImg,
          defaultVibrateTimings: true,
          defaultLightSettings: true,
          // Inline action buttons
          // (defined in Android Notification Channel in MainActivity)
        },
      },
      apns: { payload: { aps: { badge: 1, sound: 'default', category: 'WEATHER_ALERT' } } },
    };

    const sent = await sendFCM(user.fcmToken, message);
    console.log(`[WEATHER-PUSH] ${sent ? 'Sent' : 'Simulated'} | ${alertType} | ${alertTitle} â†’ ${user.name || userId}`);
    res.json({ sent, simulated: !sent });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// â”€â”€â”€ AERATOR CHECK PUSH â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// POST /api/push/aerator-check
// Sends FCM to farmer with Android action buttons (Update Now / Remind Tomorrow)
farmer.post('/push/aerator-check', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const { pondId, pondName, doc, stageLabel } = req.body;
    const userId = req.user.id;

    if (mongoose.connection.readyState !== 1) return dbOffline(res);
    const user = await UserMongo.findById(userId);

    if (!user?.fcmToken) {
      return res.json({ sent: false, reason: 'No FCM token registered for this user' });
    }

    const docStage = Number(doc) <= 20 ? 'Nursery' : Number(doc) <= 40 ? 'Early Growth' : Number(doc) <= 60 ? 'Mid Growth' : 'Pre-Harvest';
    const message: admin.messaging.Message = {
      token: user.fcmToken,
      notification: {
        title: `ðŸ’¨ Aerator Check Required â€” DOC ${doc}`,
        body: `${pondName} | ${docStage} Stage`,
        imageUrl: 'https://aquagrow.onrender.com/assets/push/aerator_banner.png',
      },
      data: {
        type: 'aerator_check',
        pondId: String(pondId),
        pondName: String(pondName),
        doc: String(doc),
        deepLink: `/ponds/${pondId}?tab=aerators`,
      },
      android: {
        priority: 'high',
        ttl: 7200000,
        notification: {
          channelId: 'aquagrow-aerator',
          color: '#3B82F6',
          icon: 'ic_stat_aquagrow',
          tag: `aerator-${pondId}`,
          ticker: `AquaGrow: Aerator check due for ${pondName}`,
          notificationCount: 1,
          clickAction: 'OPEN_AERATOR',
          sound: 'alert_sound',
          visibility: 'public' as any,
          body: `ðŸ“ Pond: ${pondName}\nðŸŒ¿ Stage: ${docStage} (DOC ${doc})\nðŸ“‹ ${stageLabel}\n\nPlease update aerator count, HP & positions to meet SOP.`,
          imageUrl: 'https://aquagrow.onrender.com/assets/push/aerator_banner.png',
          defaultVibrateTimings: true,
          defaultLightSettings: true,
        },
      },
      apns: {
        payload: {
          aps: {
            badge: 1,
            sound: 'default',
            category: 'AERATOR_CHECK',
          },
        },
      },
    };

    const sent = await sendFCM(user.fcmToken, message);
    console.log(`[AERATOR-PUSH] ${sent ? 'Sent' : 'Simulated'} to ${user.name || userId} for pond ${pondName} at DOC ${doc}`);
    res.json({ sent, simulated: !sent });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// â”€â”€â”€ AERATOR QUICK CONFIRM (from notification tap) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// POST /api/ponds/:id/aerator-confirm
// Called when farmer taps "Confirm Current Setup" action button from notification
farmer.post('/ponds/:id/aerator-confirm', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const { count, hp, positions, addedNew, doc, notes } = req.body;

    const now = new Date().toISOString();
    const aeratorUpdate = {
      aerators: {
        count: Number(count) || 0,
        hp: Number(hp) || 1,
        positions: positions || [],
        addedNew: Boolean(addedNew),
        lastUpdated: now,
        lastDoc: Number(doc),
        log: [{ doc: Number(doc), date: now, count: Number(count) || 0, hp: Number(hp) || 1, positions: positions || [], addedNew: Boolean(addedNew), notes: notes || '' }],
      },
    };

    if (mongoose.connection.readyState !== 1) return dbOffline(res);

    // Merge log with existing entries
    const pond = await PondMongo.findById(id);
    if (!pond) return res.status(404).json({ error: 'Pond not found' });
    const existingLog = (pond as any).aerators?.log || [];
    aeratorUpdate.aerators.log = [...existingLog, aeratorUpdate.aerators.log[0]];

    const updated = await PondMongo.findByIdAndUpdate(id, { aerators: aeratorUpdate.aerators }, { new: true });

    // â”€â”€ Also record in AeratorLog for history/analytics â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const recommended = Math.ceil(((pond as any).size || 0) * 4);
    await new AeratorLogMongo({
      userId: req.user.id,
      pondId: id,
      pondName: (pond as any).name || '',
      doc: Number(doc),
      date: now,
      count: Number(count) || 0,
      hp: Number(hp) || 1,
      positions: positions || [],
      addedNew: Boolean(addedNew),
      notes: notes || '',
      sopMet: (Number(count) || 0) >= recommended,
      recommended,
      source: 'alert_confirm',
    }).save();

    res.json(updated);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});


// â”€â”€â”€ AERATOR SNOOZE (remind tomorrow) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// POST /api/ponds/:id/aerator-snooze
farmer.post('/ponds/:id/aerator-snooze', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const snoozeUpdate = { aeratorSnoozedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() };

    if (mongoose.connection.readyState !== 1) return dbOffline(res);
    await PondMongo.findByIdAndUpdate(id, snoozeUpdate);
    res.json({ snoozed: true });
  } catch (e: any) { res.status(400).json({ error: e.message }); }
});

// â”€â”€â”€ IoT DEVICE ALERT PUSH â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// POST /api/push/iot-alert
// Called client-side when polling detects offline/warning device or aerator issue.
// Sends high-priority FCM push with step-by-step guidance for the farmer.
//
// Body: { alertType, deviceId, deviceName, deviceType, pondId, pondName, signal, guidance }
// alertType: 'connection_lost' | 'aerator_fault' | 'sensor_offline' | 'signal_weak' | 'reconnected'
farmer.post('/push/iot-alert', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const { alertType, deviceId, deviceName, deviceType, pondId, pondName, signal, guidance } = req.body;
    const userId = req.user.id;

    if (mongoose.connection.readyState !== 1) return dbOffline(res);
    const user = await UserMongo.findById(userId);

    if (!user?.fcmToken) {
      return res.json({ sent: false, reason: 'No FCM token registered' });
    }

    // â”€â”€ Build alert content based on alert type â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const ALERT_META: Record<string, { emoji: string; title: string; body: (dn: string, pn: string, sig?: number) => string; color: string; channelId: string }> = {
      connection_lost: {
        emoji: 'ðŸ“¡',
        title: 'âš ï¸ IoT Device Offline',
        body: (dn, pn) => `${dn} on ${pn} lost connection. Check power supply and Wi-Fi. Tap to troubleshoot.`,
        color: '#EF4444',
        channelId: 'aquagrow-premium',
      },
      aerator_fault: {
        emoji: 'ðŸ’¨',
        title: 'ðŸš¨ Aerator Fault Detected',
        body: (dn, pn) => `${dn} on ${pn} appears to have stopped. Check motor, relay board and power. Immediate action needed.`,
        color: '#F97316',
        channelId: 'aquagrow-premium',
      },
      sensor_offline: {
        emoji: 'ðŸ”Œ',
        title: 'ðŸ“¡ Water Sensor Offline',
        body: (dn, pn) => `${dn} on ${pn} disconnected. DO and pH readings are unavailable. Check probe and cable.`,
        color: '#F59E0B',
        channelId: 'aquagrow-premium',
      },
      signal_weak: {
        emoji: 'ðŸ“¶',
        title: 'ðŸ“¶ Weak IoT Signal',
        body: (dn, pn, sig) => `${dn} on ${pn} has low signal (${sig ?? '?'}%). Move router closer or check antenna to prevent data loss.`,
        color: '#8B5CF6',
        channelId: 'aquagrow-premium',
      },
      reconnected: {
        emoji: 'âœ…',
        title: 'âœ… Device Reconnected',
        body: (dn, pn) => `${dn} on ${pn} is back online. Live monitoring resumed.`,
        color: '#10B981',
        channelId: 'aquagrow-premium',
      },
    };

    const meta = ALERT_META[alertType] || ALERT_META['connection_lost'];

    const message: admin.messaging.Message = {
      token: user.fcmToken,
      notification: {
        title: `${meta.emoji} ${meta.title}`,
        body: meta.body(deviceName || 'Device', pondName || 'Pond', signal),
      },
      data: {
        type: 'iot_alert',
        alertType: String(alertType || ''),
        deviceId: String(deviceId || ''),
        deviceName: String(deviceName || ''),
        deviceType: String(deviceType || ''),
        pondId: String(pondId || ''),
        pondName: String(pondName || ''),
        signal: String(signal ?? ''),
        guidance: String(guidance || ''),
        deepLink: '/smart-farm?tab=iot',
      },
      android: {
        priority: 'high',
        // TTL 1 hour â€” IoT alert is time-sensitive; stale delivery is unhelpful
        ttl: 3600000,
        notification: {
          channelId: meta.channelId,
          color: meta.color,
          icon: 'ic_stat_aquagrow',
          tag: `iot-${deviceId}`,
          ticker: `AquaGrow: ${meta.title}`,
          notificationCount: 1,
          clickAction: 'OPEN_SMART_FARM',
          sound: 'alert_sound',
          visibility: 'public' as any,
          body: `ðŸ“¡ Device: ${deviceName || 'Device'}\nðŸŸ Pond: ${pondName || 'Pond'}${guidance ? `\n\nðŸ› ï¸ Fix: ${guidance}` : ''}`,
          defaultVibrateTimings: true,
          defaultLightSettings: true,
        },
      },
      apns: {
        headers: { 'apns-priority': '10', 'apns-push-type': 'alert' },
        payload: { aps: { badge: 1, sound: 'default', category: 'IOT_ALERT', 'content-available': 1 } },
      },
    };

    const sent = await sendFCM(user.fcmToken, message);
    console.log(`[IOT-PUSH] ${sent ? 'Sent' : 'Simulated'} | ${alertType} | ${deviceName} on ${pondName}`);
    res.json({ sent, simulated: !sent, alertType });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// â”€â”€â”€ IoT DEVICE STATUS QUERY â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// GET /api/iot/status/:userId
// Returns connection health snapshot for all devices belonging to this user's ponds.
// In production, this would query a real IoT broker (MQTT / Firebase RTDB).
// Currently derives status from pond.sensorId presence + simulated signal decay.
iotStatus.get('/status/:userId', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return dbOffline(res);
    const ponds = await PondMongo.find({ userId: req.user.id, status: 'active' });

    const devices = ponds.flatMap((pond: any) => {
      const doc = Math.floor((Date.now() - new Date(pond.stockingDate || Date.now()).getTime()) / 86400000);
      const aerCount = pond.aerators?.count ?? (doc > 60 ? 5 : doc > 40 ? 3 : doc > 20 ? 2 : 1);
      const hp = pond.aerators?.hp ?? 1;
      const positions = pond.aerators?.positions ?? [];

      // Sensor device
      const sensor = {
        id: `sensor-${pond._id}`,
        pondId: String(pond._id),
        pondName: pond.name,
        type: 'sensor',
        name: pond.sensorId ? `Sensor #${pond.sensorId}` : 'Water Sensor',
        sensorId: pond.sensorId || null,
        signal: pond.sensorId ? 88 : 0,
        status: pond.sensorId ? 'online' : 'offline',
        isOn: !!pond.sensorId,
        power: 5,
        lastSeen: pond.sensorId ? new Date().toISOString() : null,
      };

      // Aerator devices
      const aerators = Array.from({ length: aerCount }).map((_, ai) => ({
        id: `aer-${pond._id}-${ai}`,
        pondId: String(pond._id),
        pondName: pond.name,
        type: 'aerator',
        name: positions[ai] ? `Aerator â€“ ${positions[ai]}` : `Aerator ${ai + 1}`,
        signal: pond.sensorId ? 80 + Math.floor(Math.random() * 15) : 60,
        status: 'online',
        isOn: true,
        power: hp <= 1 ? 750 : hp <= 2 ? 1100 : hp <= 3 ? 2200 : 3700,
        lastSeen: new Date().toISOString(),
      }));

      return [sensor, ...aerators];
    });

    res.json({ devices, timestamp: new Date().toISOString(), total: devices.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// â”€â”€â”€ HARVEST STAGE PUSH NOTIFICATION â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// POST /api/push/harvest-update
// Fires an FCM push to the farmer on every harvest status change
const HARVEST_STAGE_META: Record<string, { emoji: string; title: string; body: (pn: string) => string }> = {
  pending: { emoji: 'ðŸ“‹', title: 'Harvest Request Submitted', body: (p) => `${p}: Your request is live. Waiting for a buyer to accept.` },
  accepted: { emoji: 'ðŸ¤', title: 'Buyer Accepted Your Order!', body: (p) => `${p}: A buyer accepted your harvest. Prepare for quality inspection.` },
  quality_checked: { emoji: 'ðŸ”¬', title: 'Quality Check Completed âœ“', body: (p) => `${p}: Quality passed! Buyer is proceeding to weigh your harvest.` },
  weighed: { emoji: 'âš–ï¸', title: 'Weighing Done â€” Rate Check Next', body: (p) => `${p}: Harvest weighed. Buyer is confirming the final rate per kg.` },
  rate_confirmed: { emoji: 'ðŸ’°', title: 'Rate Confirmed â€” Harvest Starting!', body: (p) => `${p}: Final rate confirmed. Physical harvest is now beginning!` },
  harvested: { emoji: 'ðŸŽ£', title: 'Harvest Complete! Payment Soon', body: (p) => `${p}: Harvest is done! Payment is being processed now.` },
  paid: { emoji: 'ðŸ’¸', title: 'ðŸ’¸ Payment Released!', body: (p) => `${p}: Your payment has been released. Check your wallet!` },
  completed: { emoji: 'ðŸ†', title: 'Harvest Cycle Completed', body: (p) => `${p}: Cycle archived. Excellent work this season!` },
  cancelled: { emoji: 'âŒ', title: 'Harvest Order Cancelled', body: (p) => `${p}: Your harvest order was cancelled. You may submit a new request.` },
};

farmer.post('/push/harvest-update', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const { pondId, pondName, requestId, status } = req.body;
    const userId = req.user.id;

    if (mongoose.connection.readyState !== 1) return dbOffline(res);
    const user = await UserMongo.findById(userId);

    if (!user?.fcmToken) {
      return res.json({ sent: false, reason: 'No FCM token' });
    }

    const meta = HARVEST_STAGE_META[status];
    if (!meta) return res.json({ sent: false, reason: 'Unknown status' });

    // Rich harvest stage image per status
    const stageImages: Record<string, string> = {
      pending: 'https://aquagrow.onrender.com/assets/push/harvest_pending.png',
      accepted: 'https://aquagrow.onrender.com/assets/push/harvest_accepted.png',
      quality_checked: 'https://aquagrow.onrender.com/assets/push/harvest_quality.png',
      weighed: 'https://aquagrow.onrender.com/assets/push/harvest_weighed.png',
      rate_confirmed: 'https://aquagrow.onrender.com/assets/push/harvest_rate.png',
      harvested: 'https://aquagrow.onrender.com/assets/push/harvest_done.png',
      paid: 'https://aquagrow.onrender.com/assets/push/harvest_paid.png',
      completed: 'https://aquagrow.onrender.com/assets/push/harvest_complete.png',
      cancelled: 'https://aquagrow.onrender.com/assets/push/harvest_cancelled.png',
    };
    const harvestStageColors: Record<string, string> = {
      pending: '#6366F1', accepted: '#10B981', quality_checked: '#0EA5E9',
      weighed: '#F59E0B', rate_confirmed: '#8B5CF6', harvested: '#EC4899',
      paid: '#22C55E', completed: '#64748B', cancelled: '#EF4444',
    };
    const stageImg = stageImages[status] ?? 'https://aquagrow.onrender.com/assets/push/harvest_done.png';
    const stageColor = harvestStageColors[status] ?? '#10B981';
    const msgBody = meta.body(pondName || 'Your Pond');

    const msgPayload: admin.messaging.Message = {
      token: user.fcmToken,
      notification: {
        title: `${meta.emoji} ${meta.title}`,
        body: msgBody,
        imageUrl: stageImg,
      },
      data: {
        type: 'harvest_update',
        pondId: String(pondId || ''),
        pondName: String(pondName || ''),
        requestId: String(requestId || ''),
        status: String(status),
        deepLink: `/ponds/${pondId}/tracking`,
      },
      android: {
        priority: 'high',
        ttl: 86400000,  // 24h â€” harvest is time-sensitive
        notification: {
          channelId: 'aquagrow-harvest',
          color: stageColor,
          icon: 'ic_stat_aquagrow',
          tag: `harvest-${requestId}`,
          ticker: `AquaGrow Harvest: ${meta.title}`,
          notificationCount: 1,
          clickAction: 'OPEN_HARVEST_TRACKING',
          sound: status === 'paid' || status === 'harvested' ? 'success_chime' : 'alert_sound',
          visibility: 'public' as any,
          body: `${msgBody}\n\nðŸŸ Pond: ${pondName || 'Your Pond'}\nTap to track your harvest live â†’`,
          imageUrl: stageImg,
          defaultVibrateTimings: true,
          defaultLightSettings: true,
        },
      },
      apns: {
        payload: { aps: { badge: 1, sound: 'default', category: 'HARVEST_UPDATE' } },
      },
    };

    const sent = await sendFCM(user.fcmToken, msgPayload);
    console.log(`[HARVEST-PUSH] ${sent ? 'Sent' : 'Simulated'} â†’ ${user.name || userId} | ${pondName} | ${status}`);
    res.json({ sent, simulated: !sent });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});


import admin from 'firebase-admin';

let adminStorage: ReturnType<typeof admin.storage> | null = null;

// â”€â”€â”€ Firebase Admin Setup (for Push Notifications + Storage uploads) â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Note: In Production, set FIREBASE_SERVICE_ACCOUNT_KEY in .env
try {
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_KEY
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)
    : null;

  if (serviceAccount) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET?.trim() ||
        `${serviceAccount.project_id}.firebasestorage.app`,
    });
    adminStorage = admin.storage();
    console.log('[FCM Engine] Initialized Successfully');
    console.log('[Storage] Admin Storage ready for community image uploads');
  } else {
    console.warn('[FCM Engine] No service account found. Push notifications will be simulated/logged only.');
  }
} catch (e) {
  console.warn('[FCM Engine] Initialization skipped (service account invalid or missing)');
}

// â”€â”€â”€ Push daemon (Auto-Alert Engine) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const runPushEngine = async () => {
  try {
    const now = new Date();
    const currentHour = now.getHours();

    // Simulate Amavasya check (Simplified logic for demonstration)
    // Real logic would use a lunar calendar library
    const isAmavasya = now.getDate() === 1 || now.getDate() === 29;

    console.log(`[Push Engine] Scanning active ponds at ${now.toLocaleTimeString()}...`);

    const users = await UserMongo.find({});
    for (const u of users) {
      if (!u.fcmToken || !u.notifications) continue;

      const ponds = await PondMongo.find({ userId: u._id || u.id });

      for (const p of ponds) {
        if (p.status !== 'active' || !p.stockingDate) continue;

        // Calculate DOC (Days of Culture)
        const stocking = new Date(p.stockingDate);
        const diffMs = Math.abs(now.getTime() - stocking.getTime());
        const doc = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        let alertTitle = '';
        let alertBody = '';

        // â”€â”€â”€ AERATOR STAGE CHECK (Every 20 DOC) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const stage = Math.ceil(doc / 20);
        const stageStartDoc = (stage - 1) * 20 + 1;
        const isAeratorDue = doc >= stageStartDoc && doc <= stageStartDoc + 2;
        const pondAeratorLastDoc = (p as any).aerators?.lastDoc ?? 0;
        const lastStage = Math.ceil(pondAeratorLastDoc / 20);
        const aeratorNotUpdated = lastStage < stage;
        const snoozedUntil = (p as any).aeratorSnoozedUntil;
        const isSnoozed = snoozedUntil && new Date(snoozedUntil) > now;

        if (isAeratorDue && aeratorNotUpdated && !isSnoozed && doc > 0) {
          const stageLabel = doc <= 20 ? 'Nursery Stage' : doc <= 40 ? 'Early Growth Stage' : doc <= 60 ? 'Mid Growth Stage' : 'Pre-Harvest Stage';
          const aeratorMsg: admin.messaging.Message = {
            token: u.fcmToken!,
            notification: {
              title: `ðŸ’¨ Aerator Check Due â€” DOC ${doc}`,
              body: `${p.name}: ${stageLabel}. Update aerator count & positions for SOP compliance.`,
            },
            data: {
              type: 'aerator_check',
              pondId: String((p as any)._id || (p as any).id),
              pondName: p.name,
              doc: String(doc),
              deepLink: `/ponds/${(p as any)._id || (p as any).id}?tab=aerators`,
            },
            android: {
              priority: 'high',
              // TTL 7 hours â€” aerator check is time-critical, do not deliver stale
              ttl: 7200000,
              notification: {
                channelId: 'aquagrow-aerator',
                color: '#3B82F6',
                icon: 'ic_stat_aquagrow',
                tag: `aerator-${(p as any)._id || (p as any).id}`,
                ticker: `AquaGrow: Aerator check due for ${p.name}`,
                notificationCount: 1,
                clickAction: 'OPEN_AERATOR',
                sound: 'alert_sound',
                visibility: 'public' as any,
                body: `ðŸ“ Pond: ${p.name}\nðŸŒ¿ Stage: ${stageLabel} (DOC ${doc})\n\nPlease update aerator count & positions to meet SOP.`,
                defaultVibrateTimings: true,
                defaultLightSettings: true,
              },
            },
            apns: {
              headers: { 'apns-priority': '10', 'apns-push-type': 'alert' },
              payload: { aps: { badge: 1, sound: 'default', category: 'AERATOR_CHECK' } },
            },
          };
          await sendFCM(u.fcmToken!, aeratorMsg);
          console.log(`[AERATOR-PUSH] Sent stage check to ${u.name || ''} for ${p.name} DOC ${doc}`);
        }

        // â”€â”€â”€ CONDITION 1: Rich DOC Milestones â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const DOC_MILESTONES: Record<number, { title: string; body: string; bigBody: string; img: string; color: string }> = {
          15: {
            title: 'ðŸ¦ Day 15 Growth Check â€” Action Required!',
            body: `${p.name}: Vitamin C spike time! Check trays & apply immunity booster.`,
            bigBody: `ðŸ“ Pond: ${p.name}\n\nâœ… Action: Apply Vitamin C (1g/kg feed)\nðŸŒ¡ï¸ Check feed tray consumption\nðŸ’‰ Start Immunity Pulse booster today\n\nðŸ’ª Your shrimp are in the crucial early window!`,
            img: 'https://aquagrow.onrender.com/assets/push/doc15.png',
            color: '#22C55E',
          },
          25: {
            title: 'âš ï¸ DOC 25 â€” Prepare for Critical Stage!',
            body: `${p.name}: Apply Immunity Pulse now before DOC 30 risk window opens.`,
            bigBody: `ðŸ“ Pond: ${p.name}\n\nâš¡ DOC 30 is 5 days away â€” act now:\nâœ… Apply Immunity Pulse in feed\nðŸ”¬ Check for tail redness or white spots\nðŸ’Š Start probiotic dosing cycle\n\nðŸŽ¯ Preparation now = higher survival!`,
            img: 'https://aquagrow.onrender.com/assets/push/doc25.png',
            color: '#F59E0B',
          },
          30: {
            title: 'ðŸ“ˆ DOC 30 â€” Risk Window Starts Now!',
            body: `${p.name}: High-risk period. Watch for tail redness. Probiotics essential.`,
            bigBody: `ðŸ“ Pond: ${p.name}\n\nðŸš¨ Critical transition stage (DOC 30â€“45):\nðŸ”´ Watch for tail redness / abnormal behavior\nðŸ’§ Increase water probiotic frequency\nðŸ’¨ Run aerators 100% during 3â€“6 AM\nâš–ï¸ Cross-check FCR and feed consumption\n\nâš ï¸ Do NOT miss tray checks this week!`,
            img: 'https://aquagrow.onrender.com/assets/push/doc30.png',
            color: '#EF4444',
          },
          40: {
            title: 'ðŸ”´ DOC 40 â€” Critical Stage Alert!',
            body: `${p.name}: DOC 40 Vit-Min Booster due. Max aeration 9PMâ€“5AM.`,
            bigBody: `ðŸ“ Pond: ${p.name}\n\nðŸ’Š Apply Vit-Min Booster in feed (2g/kg)\nðŸ’¨ Run ALL aerators from 9 PM to 5 AM\nðŸ” Check trays every hour during peak\nðŸ§ª Log water quality â€” pH, DO, Ammonia\n\nðŸ… DOC 40 is the make-or-break week. Stay sharp!`,
            img: 'https://aquagrow.onrender.com/assets/push/doc40.png',
            color: '#EF4444',
          },
          45: {
            title: 'ðŸš¨ DOC 45 â€” Peak WSSV Risk Window!',
            body: `${p.name}: Maximum virus risk. Max aeration. Reduce feed on cloudy days.`,
            bigBody: `ðŸ“ Pond: ${p.name}\n\nðŸ¦  WSSV Risk at MAXIMUM â€” Act Now:\nðŸ’¨ Max aeration 24/7 for next 5 days\nâ¬ Reduce feed by 10% on cloudy/rainy days\nðŸ”¬ Check for white spots on carapace\nðŸ“ž Any mortality spike? Call expert immediately!\n\nðŸ›¡ï¸ Your vigilance is the vaccine. Don't relax!`,
            img: 'https://aquagrow.onrender.com/assets/push/doc45.png',
            color: '#EF4444',
          },
          50: {
            title: 'ðŸ’Š DOC 50 â€” Liver Tonic Time',
            body: `${p.name}: Hepatopancreas protection due. Apply Liver Tonic in feed today.`,
            bigBody: `ðŸ“ Pond: ${p.name}\n\nðŸ’Š Today's Protocol:\nðŸŸ¡ Apply Liver Tonic (2ml/kg feed)\nâš–ï¸ Check ABW â€” shrimp should be 5â€“7g\nðŸ’§ Partial water exchange if DO drops\nðŸ“‹ Record medicine log in AquaGrow\n\nðŸŒ± DOC 50: Hepatopancreas strength = harvest yield!`,
            img: 'https://aquagrow.onrender.com/assets/push/doc50.png',
            color: '#8B5CF6',
          },
          60: {
            title: 'ðŸ”µ DOC 60 â€” Growth Spurt Phase',
            body: `${p.name}: 1g growth spike expected! Double Water Probiotic application.`,
            bigBody: `ðŸ“ Pond: ${p.name}\n\nðŸš€ Growth Acceleration Week:\nðŸ’§ Apply Water Probiotic Max every 2 days\nðŸ¤ Increase feed ration by 10% if trays are clean\nðŸ“ ABW target: 8â€“10g by DOC 65\nðŸ’¨ Night aeration critical â€” DO must stay above 5\n\nðŸ† You're 30 days from a record harvest!`,
            img: 'https://aquagrow.onrender.com/assets/push/doc60.png',
            color: '#3B82F6',
          },
          70: {
            title: 'ðŸŸ£ DOC 70 â€” Final Immunity Boost',
            body: `${p.name}: Last immunity protocol before harvest prep. Follow SOP.`,
            bigBody: `ðŸ“ Pond: ${p.name}\n\nðŸŽ¯ Final Immunity Protocol:\nðŸ’‰ Apply final Vit-C + Mineral mix (3g/kg feed)\nâš–ï¸ ABW check â€” should be 12â€“15g for Vannamei\nðŸ“‹ Plan withdrawal schedule (no heavy meds after DOC 80)\nðŸª Check market rates in AquaGrow â†’ Market\n\nðŸŒŸ Finish strong. You're almost there!`,
            img: 'https://aquagrow.onrender.com/assets/push/doc70.png',
            color: '#8B5CF6',
          },
          83: {
            title: 'â° DOC 83 â€” Harvest Prep Has Begun!',
            body: `${p.name}: STOP heavy medicines. Withdrawal period active.`,
            bigBody: `ðŸ“ Pond: ${p.name}\n\nðŸš« STOP all heavy medicines now!\nâœ… Only Vitamin C + probiotics allowed\nðŸ’§ Fresh water exchange: 20â€“30% today\nâš–ï¸ ABW target: 15â€“18g before harvest\nðŸ“² Open AquaGrow â†’ Harvest to submit your order\n\nðŸŽ£ 1 week to go. Prepare your team and buyer!`,
            img: 'https://aquagrow.onrender.com/assets/push/doc83.png',
            color: '#EC4899',
          },
          90: {
            title: 'ðŸŽ‰ DOC 90 â€” HARVEST READY! Submit Now!',
            body: `${p.name}: Zero medicines. Shell quality check done. Submit harvest order!`,
            bigBody: `ðŸ“ Pond: ${p.name}\n\nðŸ† YOUR SHRIMP ARE HARVEST-READY!\n\nâœ… Zero heavy medicines for 7+ days\nðŸ”¬ Shell quality: firm & dark\nâš–ï¸ Estimated yield: check ABW Ã— survival%\nðŸ“² AquaGrow â†’ Harvest â†’ New Request\nðŸ’° Check live market rates before pricing\n\nðŸŽŠ Congratulations! Another successful cycle!`,
            img: 'https://aquagrow.onrender.com/assets/push/harvest_done.png',
            color: '#22C55E',
          },
        };

        if (DOC_MILESTONES[doc]) {
          alertTitle = DOC_MILESTONES[doc].title;
          alertBody = DOC_MILESTONES[doc].body;
        }

        // â”€â”€â”€ CONDITION 2: Amavasya / Purnima Lunar Alert â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        else if (isAmavasya && u.notifications.water) {
          alertTitle = `ðŸŒ‘ Amavasya High Molt Risk Tonight!`;
          alertBody = `${p.name}: Mass molting + DO drop risk. Run 100% aerators. Reduce feed by 25%. Stay alert!`;
        }

        // â”€â”€â”€ CONDITION 3: 6 AM Morning Feed Reminder â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        else if (currentHour === 6 && u.notifications.feed) {
          alertTitle = `ðŸ¦ Time to Feed Your Shrimp â€“ Don't Miss It!`;
          alertBody = `Good morning! First feed time for ${p.name} (DOC ${doc}). Apply 4-5 balanced meals today. Check trays.`;
        }

        // â”€â”€â”€ CONDITION 4: 9 PM DO / Aeration Alert â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        else if (currentHour === 21 && u.notifications.water && !isAmavasya) {
          alertTitle = `ðŸ’¨ 9 PM Aeration Check â€” ${p.name}`;
          alertBody = `Night aeration window (9PMâ€“5AM). Maintain DO above 4.5 mg/L. DOC ${doc} â€” check all aerators now.`;
        }

        // â”€â”€â”€ CONDITION 5: Daily Active Pond Reminder (fallback â€” always fires) â”€â”€
        // Ensures at least one daily notification per active pond even when
        // no milestone / lunar / time-specific condition matches.
        else if (!alertTitle && doc > 0) {
          const stageLabel =
            doc <= 20 ? 'Nursery Stage' :
              doc <= 40 ? 'Early Growth Stage' :
                doc <= 60 ? 'Mid Growth Stage' :
                  doc <= 80 ? 'Pre-Harvest Stage' : 'Harvest Ready Stage';
          alertTitle = `ðŸŒŠ Daily Update â€” ${p.name} | DOC ${doc}`;
          alertBody = `${stageLabel}: Check trays, log water quality & verify aerators. Tap to open pond.`;
        }

        // --- DELIVERY LOGIC ---
        if (alertTitle && alertBody) {
          console.log(`[FCM-TRIGGER] Condition Met for ${u.name}: ${alertTitle}`);

          // Determine channel + color + deepLink per alert type
          const isLunar = alertTitle.includes('Amavasya') || alertTitle.includes('Purnima');
          const isFeed = alertTitle.includes('Feeding') || alertTitle.includes('Feed');
          const pondIdStr = String((p as any)._id || (p as any).id || '');
          const channelId = isLunar ? 'aquagrow-premium' : isFeed ? 'aquagrow-aerator' : 'aquagrow-premium';
          const color = isLunar ? '#6366F1' : isFeed ? '#F59E0B' : '#10B981';
          const deepLinkUrl = `/ponds/${pondIdStr}`;
          const alertType = isLunar ? 'lunar' : isFeed ? 'feed_reminder' : 'milestone';

          // Pull rich content from the milestone map if available
          const milestoneData = DOC_MILESTONES[doc] || null;
          const richBody = milestoneData?.bigBody || alertBody;
          const richImg = milestoneData?.img || (isLunar
            ? 'https://aquagrow.onrender.com/assets/push/lunar_alert.png'
            : isFeed
              ? 'https://aquagrow.onrender.com/assets/push/feed_reminder.png'
              : 'https://aquagrow.onrender.com/assets/push/milestone.png');
          const richColor = milestoneData?.color || color;

          const fullMessage: admin.messaging.Message = {
            token: u.fcmToken!,
            notification: {
              title: alertTitle,
              body: alertBody,
              imageUrl: richImg,
            },
            data: {
              type: alertType,
              pondId: pondIdStr,
              pondName: p.name || '',
              doc: String(doc),
              deepLink: deepLinkUrl,
            },
            android: {
              priority: 'high',
              ttl: 3600000,
              notification: {
                channelId,
                icon: 'ic_stat_aquagrow',
                color: richColor,
                tag: `engine-${u._id}-${now.toDateString().replace(/ /g, '_')}`,
                ticker: `AquaGrow: ${alertTitle}`,
                notificationCount: 1,
                sound: 'alert_sound',
                visibility: 'public' as any,
                clickAction: 'FCM_PLUGIN_ACTIVITY',
                // BigText: expanded notification shows full farming guide
                body: richBody,
                imageUrl: richImg,
                defaultVibrateTimings: true,
                defaultLightSettings: true,
              },
            },
            apns: {
              payload: {
                aps: {
                  badge: 1,
                  sound: 'default',
                  category: isLunar ? 'LUNAR_ALERT' : isFeed ? 'FEED_REMINDER' : 'MILESTONE',
                },
              },
            },
          };

          const engineSent = await sendFCM(u.fcmToken!, fullMessage);
          if (engineSent) {
            console.log(`[FCM-SUCCESS] âœ… Sent to ${u.name || String(u._id)} | ${p.name} | DOC ${doc} | ${alertTitle}`);
          } else {
            console.warn(`[FCM-FAIL] âŒ sendFCM returned false for ${u.name || String(u._id)} â€” token may be stale or Firebase not initialized. Token: ${u.fcmToken!.slice(0, 20)}...`);
          }
        }
      }
    }

    // â”€â”€â”€ WEATHER CHECK: per-user, once per daemon cycle â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Fetch real OWM weather for each user's location. Send FCM for critical /
    // warning conditions. Suppress if the same alert was already sent in last 3h.
    const weatherSuppressMap = new Map<string, number>(); // userId â†’ last alert timestamp

    for (const u of users) {
      if (!u.fcmToken || !u.notifications) continue;

      const city = (u as any).location || 'Nellore';
      const suppressed = weatherSuppressMap.get(String(u._id));
      if (suppressed && (Date.now() - suppressed) < 3 * 60 * 60 * 1000) continue;

      const weatherBrief = await fetchWeatherBrief(city);
      if (!weatherBrief) continue;

      const wxAlerts = buildWeatherAlerts(weatherBrief);
      // Only push the most severe alert per cycle (avoid notification flood)
      const topAlert = wxAlerts.find(a => a.type === 'critical') ?? wxAlerts.find(a => a.type === 'warning');
      if (!topAlert) continue;

      const wxEmoji = topAlert.type === 'critical' ? 'ðŸš¨' : 'âš ï¸';
      const wxCondImg = weatherBrief.conditionCode === 'storm'
        ? 'https://aquagrow.onrender.com/assets/push/storm.png'
        : weatherBrief.conditionCode === 'rain'
          ? 'https://aquagrow.onrender.com/assets/push/rain.png'
          : weatherBrief.conditionCode === 'hot'
            ? 'https://aquagrow.onrender.com/assets/push/hot.png'
            : 'https://aquagrow.onrender.com/assets/push/sunny.png';

      const wxMsg: admin.messaging.Message = {
        token: u.fcmToken!,
        notification: {
          title: `${wxEmoji} ${topAlert.title}`,
          body: topAlert.body,
          imageUrl: wxCondImg,
        },
        data: {
          type: 'weather_alert',
          alertType: topAlert.type,
          conditionCode: weatherBrief.conditionCode,
          location: weatherBrief.location,
          temp: String(weatherBrief.temp),
          rainPct: String(weatherBrief.rainPct),
          aqAction: topAlert.aqAction,
          deepLink: '/weather',
        },
        android: {
          // ALWAYS high â€” 'normal' priority messages are NOT delivered to killed apps
          priority: 'high',
          ttl: 3600000,
          notification: {
            channelId: 'aquagrow-premium',
            icon: 'ic_stat_aquagrow',
            color: topAlert.color,
            tag: `weather-${String(u._id)}-${now.toDateString()}`,
            ticker: `AquaGrow Weather: ${topAlert.title}`,
            notificationCount: 1,
            sound: 'alert_sound',
            visibility: 'public' as any,
            clickAction: 'OPEN_WEATHER_ALERTS',
            // BigText expanded â€” shows full aquaculture action
            body: `${topAlert.body}\n\nðŸŒ¾ AQ Action: ${topAlert.aqAction}\nðŸ“ ${weatherBrief.location} | ðŸŒ¡ï¸ ${weatherBrief.temp}Â°C | ðŸŒ§ï¸ ${weatherBrief.rainPct}%`,
            imageUrl: wxCondImg,
            defaultVibrateTimings: true,
            defaultLightSettings: true,
          },
        },
        apns: {
          headers: {
            'apns-priority': '10',          // 10 = immediate, 5 = power-efficient
            'apns-push-type': 'alert',
          },
          payload: {
            aps: {
              badge: 1,
              sound: 'default',
              category: 'WEATHER_ALERT',
              'content-available': 1,       // wake iOS background process
            },
          },
        },
      };

      const wxSent = await sendFCM(u.fcmToken!, wxMsg);
      console.log(`[WEATHER-DAEMON] ${wxSent ? 'Sent' : 'Simulated'} | ${topAlert.type} | ${topAlert.title} â†’ ${u.name || String(u._id)} | ${city}`);
      if (wxSent) weatherSuppressMap.set(String(u._id), Date.now());
    }

  } catch (e) { console.error('[Push Engine Error]', e); }
};

// â”€â”€â”€ Start â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
if (process.env.NODE_ENV !== 'test') {
  if (!process.env.MONGODB_URI?.trim()) {
    throw new Error('MONGODB_URI is required');
  }
  if (process.env.NODE_ENV === 'production') {
    for (const key of ['JWT_SECRET', 'REFRESH_TOKEN_SECRET', 'FACTORY_KEY']) {
      if (!process.env[key]?.trim()) throw new Error(`${key} is required in production`);
    }
  }
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Aqua Server] Running on http://0.0.0.0:${PORT}`);
    console.log(`[Aqua Server] Port ${PORT} claimed.`);

    connectDB().then(async () => {
      console.log(`[Aqua Server] âœ… UNIFIED MongoDB (aquagrow) connected â€” farmers, providers, orders all in ONE DB. AI: ${process.env.GEMINI_API_KEY ? 'READY' : 'MISSING API KEY'}`);

      // connectProviderDB is now a no-op â€” all provider models use the shared aquagrow DB.
      // Calling it here just fires the info log and returns immediately.
      connectProviderDB().catch(() => { });


      if (process.env.ENABLE_BACKGROUND_JOBS !== 'false') {
        startIoTAlertJob(sendFCM);
        runPushEngine().catch(e => console.error('[Push Engine] Startup run failed:', e));
        setInterval(runPushEngine, 15 * 60 * 1000);
      }

      // â”€â”€ Keep-alive ping: prevents Render free tier from sleeping â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      // Pings own /api/health every 14 minutes so the server never cold-starts
      setInterval(async () => {
        try {
          await fetch(`http://localhost:${PORT}/api/health`);
          console.log('[Keep-Alive] Self-ping OK');
        } catch (e) {
          console.warn('[Keep-Alive] Self-ping failed:', (e as Error).message);
        }
      }, 14 * 60 * 1000);
    }).catch(err => {
      // connectDB already calls process.exit(1) on failure â€” this catch won't be reached
      console.error('[Aqua Server] Startup DB error:', err.message);
    });
  });
}

export default app;
