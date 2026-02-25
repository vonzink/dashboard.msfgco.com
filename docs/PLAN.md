# Implementation Plan: Funded Loans Section + Per-User Monday.com Board Mapping + Goals Rework

## Overview

Three interconnected changes:
1. **Per-user Monday.com board mapping** — Admins assign a specific board ID to each user (for both Pipeline AND Funded Loans)
2. **Funded Loans section** — New dashboard section below Pipeline, fed by Monday.com via per-user board sync
3. **Goals moved below Funded Loans** — Goals auto-calculate "Loans Closed" and "Volume Closed" from funded loans data

---

## Current Section Order (index.html)
```
1. News & Announcements
2. Performance & Goals    ← will MOVE to position 4
3. Loan Pipeline
4. Team Chat
```

## New Section Order
```
1. News & Announcements
2. Loan Pipeline          (unchanged, but per-user board mapping)
3. Funded Loans           ← NEW
4. Performance & Goals    ← MOVED here, auto-calculates from funded loans
5. Team Chat
```

---

## Step 1: Database Migration — Per-User Board Assignments

**File:** `backend/db/migrations/006_user_board_assignments.sql`

Create a new table `user_board_assignments` to map each user to their Monday.com boards:

```sql
CREATE TABLE IF NOT EXISTS user_board_assignments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    board_type ENUM('pipeline', 'funded_loans') NOT NULL,
    monday_board_id VARCHAR(50) NOT NULL,
    assigned_by INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY unique_user_board_type (user_id, board_type),
    INDEX idx_board_type (board_type),

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE SET NULL
);
```

Also add `monday_item_id` column to `funded_loans` table for deduplication during sync:

```sql
ALTER TABLE funded_loans ADD COLUMN monday_item_id VARCHAR(50) NULL;
ALTER TABLE funded_loans ADD UNIQUE INDEX idx_monday_item_id (monday_item_id);
ALTER TABLE funded_loans ADD COLUMN last_synced_at TIMESTAMP NULL;
```

Also create a `monday_funded_column_mappings` table (separate from pipeline mappings):

```sql
CREATE TABLE IF NOT EXISTS monday_funded_column_mappings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    board_id VARCHAR(50) NOT NULL,
    monday_column_id VARCHAR(100) NOT NULL,
    monday_column_title VARCHAR(255),
    funded_field VARCHAR(100) NOT NULL,
    display_label VARCHAR(255),
    display_order INT DEFAULT 99,
    visible TINYINT(1) DEFAULT 1,

    UNIQUE KEY unique_board_col (board_id, monday_column_id),
    INDEX idx_board (board_id)
);
```

---

## Step 2: Backend — User Board Assignment API

**File:** `backend/routes/monday.js` (extend existing)

New endpoints:

- `GET /api/monday/user-boards` — List all user→board assignments (admin only)
- `GET /api/monday/user-boards/:userId` — Get boards for a specific user
- `POST /api/monday/user-boards` — Assign a board to a user (admin only)
  - Body: `{ userId, boardType: 'pipeline'|'funded_loans', mondayBoardId }`
- `DELETE /api/monday/user-boards/:userId/:boardType` — Remove assignment (admin only)

Modify the existing sync to be per-user-board aware:
- `POST /api/monday/sync` — Enhanced to sync Pipeline boards per-user AND Funded Loans boards per-user
- For each user with an assigned board, fetch items from their board and upsert into pipeline/funded_loans
- The `assigned_lo_id` is automatically set to that user

---

## Step 3: Backend — Funded Loans Monday.com Sync

**File:** `backend/routes/monday.js` (extend)

New endpoints for funded loans column mapping:

- `GET /api/monday/funded/columns?board=ID` — Fetch columns from a funded loans board
- `GET /api/monday/funded/mappings?board=ID` — Get saved funded loans column mappings
- `POST /api/monday/funded/mappings` — Save funded loans column mappings
- `GET /api/monday/funded/view-config` — Column display config for funded loans table
- `POST /api/monday/funded/sync` — Trigger funded loans sync from Monday.com
- `GET /api/monday/funded/sync/status` — Last sync status for funded loans

Valid funded loan fields to map:
```
client_name, loan_amount, loan_type, funded_date, investor,
property_address, notes, assigned_lo_name
```

The sync logic mirrors the pipeline sync but targets the `funded_loans` table with `monday_item_id` for upserts.

---

## Step 4: Backend — Register Funded Loans Route

**File:** `backend/server.js`

Add the funded loans route that already exists:
```js
const fundedLoansRoutes = require('./routes/fundedLoans');
app.use('/api/funded-loans', authenticate, fundedLoansRoutes);
```

---

## Step 5: Frontend — ServerAPI Funded Loans Methods

**File:** `js/api-server.js`

Add new methods:
```js
// Funded Loans
getFundedLoans(params) { ... }         // GET /funded-loans
getFundedLoansSummary(params) { ... }  // GET /funded-loans/summary

// Monday.com funded loans integration
getMondayFundedColumns(boardId) { ... }
getMondayFundedMappings(boardId) { ... }
saveMondayFundedMappings(mappings, boardId) { ... }
syncMondayFunded() { ... }
getMondayFundedSyncStatus() { ... }
getMondayFundedViewConfig() { ... }

// User board assignments
getMondayUserBoards() { ... }
setMondayUserBoard(userId, boardType, mondayBoardId) { ... }
deleteMondayUserBoard(userId, boardType) { ... }
```

---

## Step 6: Frontend — Funded Loans Section in HTML

**File:** `index.html`

1. **Move** the Goals section (lines 262-311) to AFTER the new Funded Loans section
2. **Add** new Funded Loans section right after Pipeline (after line 351):

```html
<!-- Funded Loans (Monday.com Sync) -->
<section class="section-card animate-in" id="fundedLoansSection">
  <div class="section-header">
    <h2 class="section-title"><i class="fas fa-check-circle"></i> Funded Loans</h2>
    <div class="section-actions">
      <input type="text" id="fundedSearch" class="search-input" placeholder="Search funded loans..." />
      <select class="filter-select" id="fundedLO">
        <option value="">All Loan Officers</option>
      </select>
      <select class="filter-select" id="fundedPeriod">
        <option value="mtd">This Month</option>
        <option value="ytd" selected>Year to Date</option>
      </select>
      <button type="button" class="btn btn-secondary btn-sm" id="fundedSyncBtn" title="Sync Funded Loans">
        <i class="fas fa-sync-alt"></i> Sync
      </button>
      <button type="button" class="btn btn-secondary btn-sm" data-action="funded-settings" title="Funded Loans Settings">
        <i class="fas fa-cog"></i>
      </button>
    </div>
  </div>

  <div class="section-body">
    <!-- Summary cards -->
    <div class="funded-summary" id="fundedSummary">
      <div class="funded-summary-card">
        <div class="funded-summary-label">Loans Funded</div>
        <div class="funded-summary-value" id="fundedCount">0</div>
      </div>
      <div class="funded-summary-card">
        <div class="funded-summary-label">Total Volume</div>
        <div class="funded-summary-value" id="fundedVolume">$0</div>
      </div>
    </div>

    <div class="sync-status-bar" id="fundedSyncStatusBar" style="display:none;">
      <i class="fas fa-info-circle"></i>
      <span id="fundedSyncStatusText">Last synced: Never</span>
    </div>

    <div class="table-responsive">
      <table class="data-table" id="fundedLoansTable">
        <thead id="fundedLoansHead">
          <tr><th colspan="8"><i class="fas fa-spinner fa-spin"></i> Loading funded loans...</th></tr>
        </thead>
        <tbody id="fundedLoansBody">
          <tr><td class="empty-state">
            <i class="fas fa-database"></i>
            <p>No funded loans data yet.</p>
          </td></tr>
        </tbody>
      </table>
    </div>
  </div>
</section>
```

3. Then place the Goals section (moved from above)
4. Add `funded-loans.js` to script tags

---

## Step 7: Frontend — Funded Loans JS Module

**File:** `js/funded-loans.js` (NEW)

Create `FundedLoans` object with:
- `loadFundedLoansConfig()` — load view-config for columns
- `loadFundedLoans()` — fetch data and render table (mirrors pipeline pattern)
- `renderFundedLoansHead()` / `renderFundedLoans(data)` — table rendering
- `updateSummary(summary)` — update the count/volume cards
- `filterFundedLoans()` — search + LO + period filtering
- Sync button handler → calls `ServerAPI.syncMondayFunded()`

---

## Step 8: Frontend — Goals Auto-Calculate from Funded Loans

**File:** `js/goals.js`

Modify `GoalsManager.loadSavedGoals()` to:
1. After loading goal targets from API, also fetch funded loans summary
2. Call `ServerAPI.getFundedLoansSummary({ period })` to get count + total_amount
3. Auto-set `loans-closed.current = summary.units` (count of funded loans)
4. Auto-set `volume-closed.current = summary.total_amount` (sum of loan amounts)
5. Keep pull-through as manual
6. Call `updateAllGoals()` to re-render

---

## Step 9: Frontend — Monday.com Settings Modal Updates

**File:** `index.html` + `js/api.js`

Extend the Monday.com Settings modal to include:
1. **User Board Assignments** tab — Admin can select each user and assign Pipeline Board ID + Funded Loans Board ID
2. **Funded Loans Column Mappings** — Same pattern as pipeline mappings but for funded loans fields
3. **Funded Loans Sync** controls

---

## Step 10: CSS Updates

**File:** `css/sections.css`

Add styles for:
- `.funded-summary` — flex row for summary cards
- `.funded-summary-card` — styled stat card
- `.funded-summary-value` — large number display
- `.funded-summary-label` — small label text

---

## Step 11: Data Loading Integration

**File:** `js/api.js`

- Add `loadFundedLoans()` to `API.loadAllData()`
- Add funded loans to `DataRefresher` interval

**File:** `js/app.js`

- Add `this.initFundedLoans()` in init sequence
- Initialize FundedLoans module and settings handlers

---

## Files Modified (Summary)

| File | Change |
|------|--------|
| `backend/db/migrations/006_user_board_assignments.sql` | NEW — migration for user board assignments + funded_loans columns |
| `backend/routes/monday.js` | EXTEND — user board assignment endpoints + funded loans sync endpoints |
| `backend/server.js` | ADD — register funded-loans route |
| `js/api-server.js` | ADD — funded loans + user board API methods |
| `js/funded-loans.js` | NEW — funded loans section module |
| `js/api.js` | MODIFY — add loadFundedLoans to loadAllData + DataRefresher |
| `js/goals.js` | MODIFY — auto-calculate current values from funded loans |
| `js/app.js` | MODIFY — init funded loans module |
| `index.html` | MODIFY — reorder sections, add funded loans HTML, add script tag |
| `css/sections.css` | ADD — funded loans summary card styles |
