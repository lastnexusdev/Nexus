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

- Admin left menu now separates:
  - Dashboard (KPIs + status graph + risk notices)
  - Clients (directory + per-client management)
  - Notices (falling-behind board)

- Persistent backend storage in `data/db.json` and `storage/<client-id>/...`
- Admin can:
  - create clients
  - view dashboard metrics
  - set statuses
  - upload files into structured folders
  - view uploaded files directly from the admin file manager
  - create document requests
  - add internal notes
  - view client-visible files and audit events
- Client can:
  - sign in with portal code (generated per client)
  - see request list, status, checklist
  - upload files
  - view uploaded files directly in the portal file manager
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
- Uploads use real base64 file payloads from browser file inputs.
- Internal-only files never appear in the client portal response.

## Compatibility Fix

- Added automatic DB shape normalization/migration on load to support older `data/db.json` files (e.g., legacy `auditLog` key).
- Prevents runtime crash: `TypeError: Cannot read properties of undefined (reading 'slice')` when hitting `/api/admin/dashboard`.

## Admin → Client Portal Jump

- In Admin, each client row now has a **Portal** action that opens that exact client's portal dashboard with their `portalCode` prefilled in the URL.
- This gives quick access to that user section (file manager + status + checklist) instead of staying on the global admin dashboard.


## Upload-Only Mode

- Scanner integration hooks were removed. Both Admin and Client portals now support **upload only**.
- This keeps file ingestion reliable and simple through standard file input uploads.


## Admin UX Refresh

- Main landing page is now a focused dashboard (not client-detail heavy).
- Admin client creation no longer requires tax year entry; tax years are now managed from client file operations.
- Added Admin **Add Tax Year** control (last 10 years + current) to create tax-year roots for past-year organization.
- Admin top bar now includes a **bell notification** for recent client submissions (driven by `CLIENT_UPLOAD` audit events).
- Added **Settings** page in Admin to configure client-portal deadlines (`taxSeasonStart`, `taxSeasonEnd`).
- Added client-portal top **Important Deadlines** bar with countdown to start/end dates from Admin settings.
- Notification bell now includes an **Open Client** action for each client submission to jump directly into that client workspace.
- Added request submission feedback in Admin (validation + success/error message) to prevent accidental duplicate requests.
- Admin document requests now support structured prior-year requests with selected **Tax Year** + **Document Type** (instead of only free-text generic requests).
- Client portal request uploads are now year-focused for prior-year return workflows, and quick upload is simplified to full-return uploads by tax year.
- Added status distribution graph bars and at-risk client notices.
- Added dedicated Clients and Notices pages in left navigation for cleaner workflow separation.
- Clients page now shows a full **All Clients** listing table while preserving progressive search filtering for quick narrowing.
- All Clients now supports richer directory controls: **Status/Entity/Assigned Staff** filters, clickable header sorting on **First Name** and **Last Name**, and a revised column order with **Status first**, **Email** column, and **Assigned Staff** in place of the old Years column.
- Status label **Intake Received** has been renamed to **In Progress** across app behavior and APIs.
- All-clients table now supports color coding: In Progress (gray), new unseen client upload (yellow), complete/filed (green), and at-risk (red).


## Admin UI Theme

- Updated admin look to a TimeCard-inspired professional theme:
  - dark left sidebar
  - maroon top header
  - cleaner dashboard cards and graph panels
- Clients page now uses a **select-first** workflow:
  - search/select client first
  - then load only that client's management workspace (instead of always listing all clients).
  - once selected, the search/create area is hidden and a **Return to Client List** button appears.


## Admin Client File Manager (Dedicated View)

- Inside a selected client workspace, **Client Visible Files** opens a dedicated in-page file manager view.
- The file manager now behaves like a folder browser:
  - shows visible directories first
  - click a directory to drill into files
  - use **Back to folders** to navigate up
- This keeps the core client workspace cleaner while making file navigation practical for larger accounts.


## Client Portal UI Refresh

- Redesigned client portal to match a more modern professional style.
- Added **Light / Dark mode toggle** in the portal header.
- Added a compact client summary panel (status, tax years, open requests, uploaded files).
- Preserved secure portal-code sign-in and upload-only file manager behavior.

- Client portal now includes separated sections for **Overview**, **Requests**, and **File Manager** to reduce clutter and guide clients through tasks.
- Added an action popup for pending document requests immediately after sign-in, with a direct upload control on each request card.
- Added folder-first file manager navigation for clients (folders → files → view).
- Added explicit client-side upload controls with **Upload** and **Cancel** actions (no forced instant upload).
- Request popup now uses a single bottom **Close for now** action, and request uploads mark requests complete so completed uploads stop reappearing as pending.


## File Viewing

- Added a file-view endpoint (`GET /api/files/:clientId/:fileId`) with permission checks.
- Admin roles can view any client file from the admin file manager.
- Client portal can view only that client's non-internal files via portal code authorization.
