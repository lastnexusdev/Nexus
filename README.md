# Nexus Tax Workflow App

This build is a **functional split-portal system** with no external frontend CDN dependency:

- **Admin app** at `/admin`
- **Client portal** at `/portal`

These are separate pages with separate UI/flows (not a shared mode toggle).

## Run

```bash
npm run dev
```

Open:
- Admin: `http://localhost:3000/admin`
- Client: `http://localhost:3000/portal`

## Fixed: "NetworkError when attempting to fetch resource"

The frontend no longer depends on `unpkg` (React/Babel CDNs). Both portals now use local JS files (`public/admin.js`, `public/client.js`), so the app works in restricted environments where external script/CDN requests are blocked.

## What works now (real behavior)

- Persistent backend storage in `data/db.json` and `storage/<client-id>/...`
- Admin can:
  - create clients
  - view dashboard metrics
  - set statuses
  - upload files into structured folders
  - scan/camera-capture documents directly into client folders
  - create document requests
  - add internal notes
  - view client-visible files and audit events
- Client can:
  - sign in with portal code (generated per client)
  - see request list, status, checklist
  - upload files
  - scan/camera-capture documents directly from their device
  - see only non-internal files

## API Highlights

- Admin
  - `GET /api/admin/dashboard`
  - `GET/POST /api/admin/clients`
  - `GET /api/admin/clients/:id`
  - `POST /api/admin/clients/:id/upload`
  - `PATCH /api/admin/clients/:id/status`
  - `POST /api/admin/clients/:id/notes`
  - `POST /api/admin/clients/:id/requests`
- Client
  - `GET /api/client/session?portalCode=...`
  - `POST /api/client/:id/upload`

## Notes

- Files are stored outside the static web root.
- Uploads use real base64 file payloads from browser file/camera inputs.
- Internal-only files never appear in the client portal response.

## Compatibility Fix

- Added automatic DB shape normalization/migration on load to support older `data/db.json` files (e.g., legacy `auditLog` key).
- Prevents runtime crash: `TypeError: Cannot read properties of undefined (reading 'slice')` when hitting `/api/admin/dashboard`.
