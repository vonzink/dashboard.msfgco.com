---
visibility: PUBLIC
---
# Loan Checklists

Dashboard section: (none — opened from a loan row in the Pipeline)

## What it is
A loan checklist is a to-do list attached to a specific loan (or pre-approval, or funded loan) — up to 3 checklists per loan. Each checklist has items with a status, an importance level, a due date, subitems, and a running log of call notes. Checklists come from templates (personal or global) or can be generated automatically from an uploaded PDF.

## How to find it
Checklists aren't a scroll section — you open them from a checklist badge/icon on a loan row (Pipeline, Pre-Approvals, or Loans Funded). Clicking the badge opens either the loan's existing checklist or a template picker to start a new one. The checklist opens as a floating panel that can be dragged by its header; clicking outside the panel still lets you interact with the rest of the page (the panel doesn't block the background).

## Common tasks

### Start a checklist for a loan
Click the checklist badge on a loan row. If the loan has no checklist yet, you'll see a template picker: choose one of your personal templates or a global (company-wide) template, or use "Make from PDF" to auto-generate a checklist from an uploaded PDF (stays local to that loan only — it won't appear as a reusable template). A loan can have at most 3 checklists; delete one before adding a 4th.

### Update an item's status
Each item cycles through: Not Started, In Progress, Submitted, Done, Incomplete, Issue, N/A. Click the status icon to advance it, or use the item's menu to jump straight to a specific status. Marking an item **Done** automatically stamps today's completion date; moving it off Done clears that date.

### Flag importance and set a due date
Use the item menu to mark an item Normal, Important, or Urgent — Urgent items always sort to the top of the list regardless of manual ordering. Set a due date from the same menu; overdue items (past due date and not yet Done) are highlighted in red.

### Reorder items and add subitems / notes
Drag an item by its row to reorder it within its importance tier (you can't drag an Urgent item below a non-Urgent one, or vice versa). Add subitems (their own status + name + date) or call notes from the item menu — call notes are time-stamped and attributed to the author, and can't be edited from the UI once saved (only deleted).

### Tag items by category and gate
Use "Set Category" (Assets, Income, REO, Credit, Title) and "Set Gate" (PTD, PTC, PTF, CTC) from the item menu to tag conditions. Use the filter chips at the top of the checklist to narrow the view to one category or gate at a time.

## FAQ
**Q: What's the difference between a personal and a global template?**
A: Personal templates are yours — you can edit or delete them. Global templates are shared company-wide and read-only for non-admins; you can still assign a global template to a loan, just not edit its master copy.

**Q: I made a checklist from a PDF — can I reuse it as a template later?**
A: No — a PDF-generated checklist is flagged file-local and stays attached to that one loan; it doesn't become a reusable template.

**Q: Why can't I edit a call note I added earlier?**
A: Call notes are intentionally immutable from the UI once saved — they're a permanent log entry. You can delete a note (if you're the author or an admin), but not edit its text in place.

**Q: How many checklists can one loan have?**
A: Up to 3. You'll need to delete one before you can add another.
