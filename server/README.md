# AquaGrow Core API

This standalone Node 24 package deploys the existing Express API as one service.
It uses the existing MongoDB database and models. The mobile frontend, portals,
and firmware can keep calling their current paths on the existing service URL
when that service is upgraded.

| Client | Versioned route example | Existing path |
| --- | --- | --- |
| Auth | /api/v1/auth/firebase-login | /api/auth/firebase-login |
| Mobile | /api/v1/farmer/user/:userId/ponds | /api/user/:userId/ponds |
| Admin | /api/v1/admin/farmers | /api/admin/farmers |
| Shop ERP | /api/v1/shop/invoices | /api/invoices |
| HR | /api/v1/hr/payslips | /api/hrms/payslips |
| IoT | /api/v1/iot/espnow/heartbeat | /api/espnow/heartbeat |
| Provider | /api/v1/provider | /api/provider |

Both versions use the existing role, ownership, tenant, and device middleware.

## Test and stage

1. Run `npm ci` and `npm test` from this directory. The smoke tests simulate
   requests with no database connection or production credentials.
2. Deploy the root Render Blueprint with a staging Atlas database and staging
   integration credentials. Provisioning the Blueprint creates a separate service.
   It disables scheduled push and IoT alert jobs while staging.
3. Supply `MONGODB_URI`, including the database name, `JWT_SECRET`,
   `REFRESH_TOKEN_SECRET`, and `FACTORY_KEY` in Render's environment settings.
   Set `FIREBASE_SERVICE_ACCOUNT_KEY` for Firebase calls. Set
   `FIREBASE_STORAGE_BUCKET` if the bucket differs from
   `<firebase-project-id>.firebasestorage.app`. Carry over the existing
   optional SMS and Gemini settings for features that use them. Set
   `CORS_ORIGINS` to a comma-separated list for any new portal domains.
4. Check `GET /api/v1/ready` for HTTP 200, then verify Firebase sign-in, pond
   ownership, admin, shop and HR permissions, and a staging Master Box heartbeat.
5. Before production cutover, coordinate rotation of credentials previously
   embedded in source and confirm the impact on sessions and device provisioning.
   Keep the existing Render service and hostname for existing clients. Set its
   root directory to `server`, build command to `npm ci`, start command to
   `npm start`, and health check to `/api/v1/ready`. Ensure the push engine is
   enabled on the sole production service.
