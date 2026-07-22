---
visibility: PUBLIC
---
# Investors

Dashboard section: (none — reached via the "Investors" menu in the top nav)

## What it is
The Investors module is the wholesale-lender reference directory — account executive contacts, product/service coverage (Conventional, FHA, VA, USDA, Jumbo, Non-QM, DSCR, Bank Statement, Bridge, Construction, etc.), lender IDs (FHA/VA/RD), mortgagee clauses, turn times, resource links, uploaded documents, and a team-shared notes/tags system. Investor records themselves (AE contact, product toggles, lender IDs, clauses, logos, documents) are admin-managed; every non-external user can browse, and everyone can add notes.

## How to find it
Click "Investors" in the top navigation bar. The dropdown lists each wholesale partner as a card (logo, name, AE, active product pills) with a search box, plus a "Show All" item at the top for the full directory table. Admins additionally see a "Manage Investors" item at the bottom of the dropdown.

## Common tasks

### Look up an investor's AE, programs, or lender IDs
Click an investor card in the Investors dropdown (or find it via "Show All") to open its detail modal: Account Executive contact, Investor Details (states, best programs, minimum FICO, in-house DPA, EPO, max comp, underwriting fee), Team, Products & Services (grouped pills — Agency/Gov, Non-Agency, Specialty, Services, Custom), Lender IDs, Mortgagee Clauses, Resources (website, login portal, FAQs, appraisal ordering, new-scenarios), Documents, and Turn Times.

### Browse or search the full investor directory
Click "Show All" in the Investors dropdown to open the All Investors table (name, AE, states, best programs, product pills, notes), with an active/inactive count and a search box that filters every column. Clicking a product/service pill (in either the dropdown or the table) auto-fills the search box with that tag.

### Add a note or tag
Inside an investor's detail modal, use the Notes section at the bottom: type in the textarea, optionally attach tags via "Manage Tags" (tags are color-grouped: Agency, Non-Agency, Specialty, Services, Processing, News, Pricing, Info, plus custom ones anyone can create), then post. You can edit or delete your own notes; admins and managers can edit or delete anyone's. A custom tag can only be deleted while it's unused.

### Manage investor records (admin)
Admins see "Manage Investors" at the bottom of the Investors dropdown, which opens the Admin Settings window on its Investors tab. From there, admins create investors and edit AE info, product/service toggles, lender IDs, mortgagee clauses, resource links, turn times, logos, and documents. Toggling an investor active/inactive is also allowed for the Manager role; all other edits (and creating/deleting an investor) require Admin.

## FAQ
**Q: Why can't I edit an investor's phone number or product toggles?**
A: Only Admins can edit an investor's core profile fields (AE contact, product/service toggles, lender IDs, mortgagee clauses, links, turn times, logos, documents). Non-admins can browse everything and add notes, but the legacy "Investor Notes" free-text field on the record itself is the only field a non-admin PUT can touch, and the modern Notes system (with tags, timestamps, and author attribution) is the intended way to leave information for the team.

**Q: Who can see "Manage Investors"?**
A: Only users with the Admin role — it's hidden from everyone else in the Investors dropdown. Manager-role users don't get this menu item even though the backend allows them to toggle an investor's active/inactive status.

**Q: Where do the product/service pills come from?**
A: Each investor record has boolean toggle fields (Conventional, FHA, VA, USDA, Jumbo, Non-QM, DSCR, Bank Statement, Bridge, Land, Construction, Renovation, Manufactured, Doctor, Condo/Non-Warrantable, Sub. Financing, HELOC/2nd, Manual UW, Servicing, Scenario Desk, Condo Review, Exception Desk, Wire/Funding Review) plus any admin-defined custom toggles; only the ones set to "on" render as pills.

**Q: Can I search by a specific program instead of typing it?**
A: Yes — click any pill (in the dropdown cards or the All Investors table) and it fills the search box with that tag's label and filters immediately.
