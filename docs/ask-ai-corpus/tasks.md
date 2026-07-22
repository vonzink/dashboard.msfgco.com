---
visibility: PUBLIC
---
# Tasks

Dashboard section: (none — no dashboard UI currently displays tasks; they're created and managed through the API and the Zapier/n8n webhook endpoint)

## What it is
Tasks are simple to-do records with a title, description, priority, status, due date/time, and an assignee. The feature exists as a full backend API (`/api/tasks`) plus a webhook endpoint (`/api/webhooks/tasks`) for automation tools like Zapier or n8n to create and update tasks. As of now there's no dashboard page or panel that lists or edits tasks — they're only reachable through the API/webhook layer.

## How to find it
There is no menu item or button for Tasks in the dashboard UI today. Tasks are created and updated via:
- The authenticated API (`/api/tasks`), used by whatever internal tooling calls it directly
- The API-key-authenticated webhook (`/api/webhooks/tasks`), meant for Zapier/n8n automations (see the Webhook endpoints admin feature for API key setup)

## Common tasks

### Create a task via webhook automation
POST to `/api/webhooks/tasks` with an API key and at minimum a `title`. Optional fields: `description`, `priority` (low/medium/high/urgent, defaults to medium), `status` (todo/in_progress/done/cancelled, defaults to todo), `due_date`, `due_time`, and `assigned_to`. This is the path a Zapier or n8n zap would use to turn some other event (a form submission, an email, etc.) into a task.

### Create many tasks at once
POST an array of task objects to `/api/webhooks/bulk/tasks` (same fields as a single task) to bulk-create tasks in one call — useful for importing a batch from another system.

### Update a task's status or assignment
PUT to `/api/tasks/:id` (authenticated) or `/api/webhooks/tasks/:id` (webhook) with any of the task fields to change, e.g. `status` to move it through todo → in_progress → done, or `assigned_to` to hand it off to someone else.

### List or filter tasks
GET `/api/tasks` returns your own tasks, or every task if you're an admin. Add `?status=` or `?priority=` query params to filter.

## FAQ
**Q: Can I see my tasks anywhere on the dashboard?**
A: Not currently — there's no dashboard page for Tasks yet. They exist as an API/webhook feature only.

**Q: Who can see a given task?**
A: Regular users only see their own tasks (matched by `user_id`); admins can see and manage every task.

**Q: What statuses can a task have?**
A: todo, in_progress, done, or cancelled.

**Q: What's the intended way to create tasks today?**
A: Through the `/api/webhooks/tasks` endpoint via an automation tool (Zapier/n8n) using an API key, or directly against `/api/tasks` if you're calling the API yourself.
