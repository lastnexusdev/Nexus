# Nexus Tax Workflow App

This build is now a **functional split-portal system**:

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
