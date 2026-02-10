# Nexus Tax Workflow App

A React + Node tax operations app with persistent backend storage (filesystem + JSON), designed for both staff productivity and a client-friendly portal experience.

## Run

```bash
npm run dev
```

Open: `http://localhost:3000`

## What changed in this version

- Richer modern UX with role switching:
  - **Admin View**: dashboard, client containers, workflow, compliance.
  - **Client View**: secure-feeling portal summary, request list, visible files.
- Stronger workflow tools for tax prep teams:
  - status pipeline board
  - checklist visibility by entity type
  - request-documents flow
  - internal notes + event timeline
- Better file operations:
  - structured folder storage per client
  - rename-on-upload + versioning
  - client-visible vs internal-only file controls
- **Direct scanning flows** from both sides:
  - admin scanner simulation (`/api/clients/:id/scan`)
  - client camera scan simulation (`/api/clients/:id/scan` from client mode)
- Portal isolation:
  - internal notes hidden from client portal
  - internal-only files hidden from client portal

## Persistence model

- `data/db.json`: durable records for clients, events, users, audit log.
- `storage/<client-id>/...`: durable uploaded/scanned file payloads.

## Security & compliance foundations

- Role-aware write restrictions (Admin/Preparer/Reviewer/Read-only/Client).
- Files kept outside static web root.
- Audit log entries for create/upload/scan/status/notes/request actions.
- Portal response is sanitized and does not include internal-only note data.
