# Loan Pipeline

Dashboard section: pipeline

## What it is
The Loan Pipeline is the working list of active loans — one row per loan, synced from Monday.com. Each row shows key details (client, loan officer, amount, subject property) and a set of status dropdowns tracking where the loan stands: **Stage**, **Title Status**, **HOI (insurance) Status**, **Payoffs**, and **Appraisal Status**, plus additional fields like WVOEs, VVOEs, HOA, DPA, and closing docs.

## How to find it
Scroll to the "Loan Pipeline" section on the dashboard home page, below Applications. The section header has a search box, a Loan Officer filter, a "Show/Hide Columns" toggle, and a "Sync" button.

## Common tasks

### Change a loan's stage or status
Click a loan row to open its detail view. The Current Stage shows as a colored pill at the top; other tracked fields (Appraisal, Prelims, Mini Set, CD, Title, Insurance, Payoffs, WVOEs, VVOEs, HOA, DPA, Closing Docs, Closing Details, CD Info) appear as dropdowns or colored pills further down. Pick a new value — you'll get an optional prompt to add a comment (which posts to the loan's Monday.com activity feed), then the change saves and write-throughs to Monday.com.

### Search and filter the pipeline
Use the search box in the section header to filter by any visible field, or use the Loan Officer dropdown to show only one LO's loans (loan officers only see their own loans; managers/admins get the full-team filter).

### Show more columns
Click "All Columns" / "Fewer Columns" in the section header to toggle between a compact priority-field view and the full column set configured for your Monday board.

### Sync from Monday.com
Click "Sync" in the section header to pull the latest data from the connected Monday.com board(s). A status bar shows the last sync time and how many items were created/updated.

### Add internal notes or open a checklist
Inside a loan's detail view, use the "Internal Notes" box to log team-only notes (not synced to Monday). Each pipeline row also shows a checklist badge — click it to open an existing checklist for that loan or start a new one from a template. See the Loan Checklists guide.

## FAQ
**Q: I changed a status but Monday.com doesn't show the update — what happened?**
A: The dashboard always saves your change locally even if the Monday write-through fails, so the dashboard can look "saved" while Monday never updated. Two things must both be true for a write-back to land: the field must be mapped in Monday's column mappings, and the value you picked must exactly match one of that board's existing Monday labels. If a status looks stuck, check with an admin about the field's Monday mapping.

**Q: Why do the dropdown options look different for the same field on different boards?**
A: Status labels mirror each loan's own Monday.com board, and different pipeline boards can have different label sets for the same column (e.g. Appraisal Status). The dashboard loads each loan's board-specific labels when available and falls back to a standard preset list otherwise.

**Q: How do I post a comment straight to the loan's Monday.com activity feed?**
A: Open the loan's detail view — if it's linked to a Monday item, there's a "Post Comment to Monday.com" box with its own Post button, separate from the optional comment prompt that appears after a status change.

**Q: Can I add a note that only my team sees, not Monday?**
A: Yes — the "Internal Notes" box in the loan detail view is team-only and never syncs to Monday.com.
