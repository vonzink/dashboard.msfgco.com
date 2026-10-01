# Webinar Studio access modes

`WEBINAR_STUDIO_ACCESS` in the backend `.env` decides who can open Webinar
Studio. It is read on every request, so changing it needs only a backend
restart. Unset or unrecognised values fail closed: Studio answers 404.

| Value | Who can open Studio | Who can edit a webinar | Who can add to the asset library |
| --- | --- | --- | --- |
| `disabled` (default) | nobody | nobody | nobody |
| `admins` | administrators | administrators | administrators |
| `assigned` | administrators, plus anyone who is the primary owner of at least one active webinar | administrators and that webinar's primary owner | administrators and primary owners |
| `everyone` | every active mapped Dashboard user | administrators and that webinar's primary owner | administrators and primary owners |

Administrators are decided server side from the Cognito-backed role. The
primary owner is the `primary_owner_user_id` on the webinar.

## What `everyone` changes

- The webinar list and every read route (`GET /api/webinars`, `GET /:id`,
  `GET /:id/history`, `GET /:id/notes`) answer for any Studio user.
- Every write route still requires the primary owner or an administrator.
  Non-owners get `403 WEBINAR_ACCESS_DENIED`.
- `GET /api/webinars/:id` carries `canEdit`, the server's decision for the
  caller. The Dashboard renders the Code tab read only when it is `false`,
  hides restore in History, and hides uploads in Assets. Those are display
  choices only; the server enforces the rule regardless.
- Writes to `/api/webinar-assets` pass a second gate: administrators and
  primary owners of an active webinar. Readers can browse the library.

## How the gate works

`backend/middleware/webinarStudioAccess.js` decides access and, when it
grants a request, annotates it with `{ mode, readAll }`. `readAll` is true
only in `everyone` mode. `services/webinars/authorization.js` uses the
annotation to widen reads, never writes. A route must opt in to read access
with `access: 'read'`; anything else keeps requiring edit rights.

## Changing the mode in production

On the box, edit `/home/ubuntu/msfg-backend/backend/.env`, set the value,
and restart with `pm2 restart msfg-backend`. Nothing else changes.
