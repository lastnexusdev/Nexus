# Nexus Tax Workflow App

A React-based tax operations dashboard with a Node backend and persistent file-based storage (JSON + filesystem), intentionally avoiding browser local storage for core records.

## Run

```bash
npm run dev
```

Open: `http://localhost:3000`

## What is included

- Client container model with structured metadata.
- Default structured folders (`Intake`, `Prior Year`, `Current Year`, `Workpapers`, `Filed Returns`, `Misc`).
- Upload workflow rules:
  - category-based auto-sort
  - timestamp rename on upload
  - overwrite guard
  - versioning (`v1`, `v2`, ...)
- Tax-specific Kanban workflow statuses.
- Missing-document tracker with visual red/yellow/green indicator.
- Role-aware API checks (`Admin`, `Preparer`, `Reviewer`, `Read-only`).
- Audit logging for uploads, notes, and status changes.
- Search/filter foundation via API query params.
- Notes timeline with @mention parsing and internal-only notes.
- Client portal phase-2 placeholder.
- Admin dashboard with workload and missing-doc visibility.

## Persistence model (non-local storage)

- `data/db.json`: persistent application data.
- `storage/<client-id>/...`: persisted file records by client and category.

## Security design notes

- File storage is kept outside the static web root (`/storage` is never served directly).
- Role restrictions are enforced server-side on write actions.
- Audit trail is timestamped and actor-attributed.
- Signed URL / expiring URL flow is listed as the next backend enhancement.
