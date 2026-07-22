---
visibility: PUBLIC
---
# Admin Settings

Dashboard section: (none — reached via the shield-icon "Admin" button in the header toolbar, Admin role only)

## What it is
Admin Settings is a separate popup window with six tabs: Employees, Investors, Forms Library, Processors, System, and Monday.com. It's where admins manage employee accounts and profiles, upload to the Forms Library, assign processors to loan officers, and check system health. The entry point (the header's "Admin" button, and "Manage Investors" in the Investors menu) only appears for users with the Admin role in the UI; the backend additionally allows the Manager role on some employee-profile actions (notes, documents, avatar/business-card/QR uploads) even though managers have no menu path into the window.

## How to find it
Click the shield icon labeled "Admin" in the header toolbar (visible only to Admins). The Investors menu's "Manage Investors" item opens the same window on its Investors tab; "Monday Settings" links elsewhere in the dashboard open it on its Monday.com tab.

## Common tasks

### Add or manage an employee
Employees tab → "Add Employee" for a new account (name, email, initials, role — User, Loan Officer, Processor, Manager, Admin, or External — and an initial password), or click an existing employee row to open their full profile across sub-tabs: Basic Info (avatar, QR codes, contact fields, NMLS/insurance/bond/computer-ID/Dropbox-path licensing fields), Social (personal + business social links, a compliance-audit date/notes field, and custom links), AI Keys (per-user integration credentials), Signature (email signature editor), Business Card (the card generator — see the Employee Directory guide), Notes (internal notes about the employee), and Documents (upload files to their record, which the employee can then view/download from their own Settings panel).

### Deactivate, permanently delete, or reset a password
From an employee's row: "Deactivate" flips them inactive and disables their Cognito login (reversible, keeps their history); "Delete Permanently" removes the DB row and their Cognito account outright (irreversible — you can't do either to your own account). "Set Password" lets an admin assign a new permanent password directly; "Reset Password" emails the employee a Cognito reset code instead.

### Upload to the Forms Library
Forms Library tab → drop files (or click to browse; PDF, DOC, XLSX, images, up to 50 MB) with an optional folder path (e.g. "Compliance/2025"). Files land directly in the `msfg-mortgage-documents-prod` S3 bucket and appear immediately in the Forms Library file browser (Tools menu → MSFG Docs).

### Assign processors to loan officers
Processors tab → for each processor, pick which loan officers' pipeline, funded loans, and pre-approvals they should see.

### Check system status
System tab shows database connectivity, active user count, total investor count, server uptime, environment, and app version, with a "Refresh" button to re-pull the numbers.

## FAQ
**Q: What's the difference between Deactivate and Delete Permanently for an employee?**
A: Deactivate is reversible — it sets the account inactive and disables Cognito login but keeps all their data and history. Delete Permanently removes their database row and Cognito account entirely and cannot be undone; neither action can be taken on your own account.

**Q: Why can't I find the Admin button?**
A: It's hidden from everyone except users with the Admin role. If you're a Manager, the backend does allow you to edit employee profiles/notes/documents and toggle an investor active/inactive, but there's currently no menu item that opens Admin Settings for you.

**Q: Where does an uploaded employee document go, and can the employee see it?**
A: It's stored against that employee's record and shown read-only in their own Settings → Documents tab, where they can view and download it but not delete or replace it.

**Q: Does the System tab let me change any settings?**
A: No — it's read-only status information (database, user/investor counts, uptime, environment, version) with a Refresh button; there's nothing to configure there.
