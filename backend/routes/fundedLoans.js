// Funded Loans API Routes
// Query funded loans with YTD/MTD filters, board-access-based access control

const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { requireDbUser } = require('../middleware/userContext');

router.use(requireDbUser);

// ========================================
// HELPER FUNCTIONS
// ========================================

/**
 * Get the user's Cognito group (role) - lowercase
 */
function getUserGroup(req) {
  const groups = req.user?.groups || [];
  return groups.length > 0 ? groups[0].toLowerCase() : null;
}

/**
 * Check if user is Admin or Manager
 */
function isAdminOrManager(req) {
  const group = getUserGroup(req);
  return group === 'admin' || group === 'manager';
}

/**
 * Check if user is Admin only
 */
function isAdmin(req) {
  return getUserGroup(req) === 'admin';
}

/**
 * Get board IDs accessible to a user (from monday_board_access)
 */
async function getAccessibleBoardIds(userId) {
  const [rows] = await db.query(
    'SELECT board_id FROM monday_board_access WHERE user_id = ?',
    [userId]
  );
  return rows.map(r => r.board_id);
}

/**
 * Get LO IDs that a processor is assigned to
 */
async function getProcessorLOIds(processorUserId) {
  const [assignments] = await db.query(
    'SELECT lo_user_id FROM processor_lo_assignments WHERE processor_user_id = ?',
    [processorUserId]
  );
  return assignments.map(a => a.lo_user_id);
}

/**
 * Build date filter for various periods
 */
function getDateFilter(period) {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');

  if (period === 'all') {
    // All time — no date restriction
    return null;
  } else if (period === 'weekly') {
    // Current week (Monday to Sunday)
    const day = now.getDay(); // 0=Sun, 1=Mon, ...
    const diffToMonday = day === 0 ? 6 : day - 1;
    const monday = new Date(now);
    monday.setDate(now.getDate() - diffToMonday);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return {
      start: monday.toISOString().split('T')[0],
      end: sunday.toISOString().split('T')[0]
    };
  } else if (period === 'monthly' || period === 'mtd') {
    const lastDay = new Date(year, now.getMonth() + 1, 0).getDate();
    return {
      start: `${year}-${month}-01`,
      end: `${year}-${month}-${lastDay}`
    };
  } else if (period === 'quarterly') {
    const quarter = Math.ceil((now.getMonth() + 1) / 3);
    const qStartMonth = String((quarter - 1) * 3 + 1).padStart(2, '0');
    const qEndMonth = String(quarter * 3).padStart(2, '0');
    const qEndLastDay = new Date(year, quarter * 3, 0).getDate();
    return {
      start: `${year}-${qStartMonth}-01`,
      end: `${year}-${qEndMonth}-${qEndLastDay}`
    };
  } else if (period === 'yearly' || period === 'ytd') {
    return {
      start: `${year}-01-01`,
      end: `${year}-12-31`
    };
  } else if (period) {
    const [customYear, customMonth] = period.split('-');
    if (customYear && customMonth) {
      const lastDay = new Date(parseInt(customYear), parseInt(customMonth), 0).getDate();
      return {
        start: `${customYear}-${customMonth}-01`,
        end: `${customYear}-${customMonth}-${lastDay}`
      };
    }
  }

  // Default: monthly
  const lastDay = new Date(year, now.getMonth() + 1, 0).getDate();
  return {
    start: `${year}-${month}-01`,
    end: `${year}-${month}-${lastDay}`
  };
}

// ========================================
// GET /api/funded-loans
// Query funded loans with filtering
// ========================================
router.get('/', async (req, res, next) => {
  try {
    const { period, board_id, group, start_date, end_date } = req.query;
    const userGroup = getUserGroup(req);
    const userId = req.user?.db?.id;

    let whereClause = 'WHERE 1=1';
    const params = [];

    // ========================================
    // ROLE-BASED + BOARD-ACCESS DATA FILTERING
    // ========================================

    if (userGroup === 'admin' || userGroup === 'manager') {
      // Admin/Manager: See all funded loans
      // Optional filter by specific board
      if (board_id) {
        whereClause += ' AND fl.source_board_id = ?';
        params.push(board_id);
      }
    } else if (userGroup === 'processor') {
      // Processor: See loans from their assigned LOs (fallback for non-Monday data)
      // AND loans from boards they have access to
      const loIds = await getProcessorLOIds(userId);
      const boardIds = await getAccessibleBoardIds(userId);

      const conditions = [];
      if (loIds.length > 0) {
        conditions.push(`fl.assigned_lo_id IN (${loIds.map(() => '?').join(',')})`);
        params.push(...loIds);
      }
      if (boardIds.length > 0) {
        conditions.push(`fl.source_board_id IN (${boardIds.map(() => '?').join(',')})`);
        params.push(...boardIds);
      }

      if (conditions.length === 0) {
        return res.json({ data: [], summary: { count: 0, total_amount: 0 }, groups: [], boards: [] });
      }
      whereClause += ` AND (${conditions.join(' OR ')})`;

      if (board_id) {
        whereClause += ' AND fl.source_board_id = ?';
        params.push(board_id);
      }
    } else if (userGroup === 'lo') {
      // LO: See only loans from boards they have access to
      const boardIds = await getAccessibleBoardIds(userId);
      if (boardIds.length === 0) {
        return res.json({ data: [], summary: { count: 0, total_amount: 0 }, groups: [], boards: [] });
      }
      whereClause += ` AND fl.source_board_id IN (${boardIds.map(() => '?').join(',')})`;
      params.push(...boardIds);

      if (board_id) {
        whereClause += ' AND fl.source_board_id = ?';
        params.push(board_id);
      }
    } else {
      return res.status(403).json({ error: 'Access denied to funded loans' });
    }

    // ========================================
    // DATE FILTERING
    // ========================================

    if (start_date && end_date) {
      whereClause += ' AND fl.funded_date >= ? AND fl.funded_date <= ?';
      params.push(start_date, end_date);
    } else {
      const dateFilter = getDateFilter(period);
      if (dateFilter) {
        whereClause += ' AND fl.funded_date >= ? AND fl.funded_date <= ?';
        params.push(dateFilter.start, dateFilter.end);
      }
      // If dateFilter is null (all time), no date restriction
    }

    // ========================================
    // GROUP FILTERING
    // ========================================

    if (group) {
      whereClause += ' AND fl.group_name = ?';
      params.push(group);
    }

    // ========================================
    // QUERY FUNDED LOANS
    // ========================================

    const [loans] = await db.query(
      `SELECT
        fl.*,
        u.name as lo_name,
        u.email as lo_email,
        mb.board_name as source_board_name
       FROM funded_loans fl
       LEFT JOIN users u ON fl.assigned_lo_id = u.id
       LEFT JOIN monday_boards mb ON fl.source_board_id = mb.board_id
       ${whereClause}
       ORDER BY fl.funded_date DESC`,
      params
    );

    // ========================================
    // CALCULATE SUMMARY
    // ========================================

    const [summary] = await db.query(
      `SELECT
        COUNT(*) as count,
        COALESCE(SUM(fl.loan_amount), 0) as total_amount
       FROM funded_loans fl
       ${whereClause}`,
      params
    );

    // ========================================
    // AVAILABLE GROUPS (for filter dropdown)
    // ========================================

    const [groupRows] = await db.query(
      `SELECT DISTINCT group_name FROM funded_loans
       WHERE group_name IS NOT NULL AND group_name != ''
       ORDER BY group_name`
    );
    const groups = groupRows.map(r => r.group_name);

    // ========================================
    // AVAILABLE BOARDS (for filter dropdown)
    // ========================================
    let boardsForFilter;
    if (isAdminOrManager(req)) {
      [boardsForFilter] = await db.query(
        `SELECT DISTINCT mb.board_id, mb.board_name
         FROM monday_boards mb
         WHERE mb.is_active = 1 AND mb.target_section = 'funded_loans'
         ORDER BY mb.board_name`
      );
    } else {
      [boardsForFilter] = await db.query(
        `SELECT DISTINCT mb.board_id, mb.board_name
         FROM monday_boards mb
         JOIN monday_board_access ba ON mb.board_id = ba.board_id
         WHERE mb.is_active = 1 AND mb.target_section = 'funded_loans' AND ba.user_id = ?
         ORDER BY mb.board_name`,
        [userId]
      );
    }

    res.json({
      data: loans,
      summary: {
        count: summary[0].count,
        total_amount: parseFloat(summary[0].total_amount) || 0
      },
      groups,
      boards: boardsForFilter,
      filters: {
        period: period || 'ytd',
        board_id: board_id || null,
        group: group || null,
        start_date: start_date || null,
        end_date: end_date || null
      }
    });

  } catch (error) {
    next(error);
  }
});

// ========================================
// GET /api/funded-loans/summary
// Get summary stats (for goals calculation)
// ========================================
router.get('/summary', async (req, res, next) => {
  try {
    const { period, board_id } = req.query;
    const userGroup = getUserGroup(req);
    const userId = req.user?.db?.id;

    let whereClause = 'WHERE 1=1';
    const params = [];

    // Role-based + board-access filtering
    if (userGroup === 'admin' || userGroup === 'manager') {
      if (board_id) {
        whereClause += ' AND source_board_id = ?';
        params.push(board_id);
      }
    } else if (userGroup === 'processor') {
      const loIds = await getProcessorLOIds(userId);
      const boardIds = await getAccessibleBoardIds(userId);
      const conditions = [];
      if (loIds.length > 0) {
        conditions.push(`assigned_lo_id IN (${loIds.map(() => '?').join(',')})`);
        params.push(...loIds);
      }
      if (boardIds.length > 0) {
        conditions.push(`source_board_id IN (${boardIds.map(() => '?').join(',')})`);
        params.push(...boardIds);
      }
      if (conditions.length === 0) {
        return res.json({ units: 0, total_amount: 0 });
      }
      whereClause += ` AND (${conditions.join(' OR ')})`;
    } else if (userGroup === 'lo') {
      const boardIds = await getAccessibleBoardIds(userId);
      if (boardIds.length === 0) {
        return res.json({ units: 0, total_amount: 0 });
      }
      whereClause += ` AND source_board_id IN (${boardIds.map(() => '?').join(',')})`;
      params.push(...boardIds);
    } else {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Date filtering
    const dateFilter = getDateFilter(period);
    if (dateFilter) {
      whereClause += ' AND funded_date >= ? AND funded_date <= ?';
      params.push(dateFilter.start, dateFilter.end);
    }

    const [summary] = await db.query(
      `SELECT
        COUNT(*) as units,
        COALESCE(SUM(loan_amount), 0) as total_amount
       FROM funded_loans
       ${whereClause}`,
      params
    );

    res.json({
      units: summary[0].units,
      total_amount: parseFloat(summary[0].total_amount) || 0,
      period: period || 'monthly'
    });

  } catch (error) {
    next(error);
  }
});

// ========================================
// GET /api/funded-loans/:id
// Get single funded loan by ID
// ========================================
router.get('/:id', async (req, res, next) => {
  try {
    const userGroup = getUserGroup(req);
    const userId = req.user?.db?.id;

    const [loans] = await db.query(
      `SELECT fl.*, u.name as lo_name, u.email as lo_email
       FROM funded_loans fl
       LEFT JOIN users u ON fl.assigned_lo_id = u.id
       WHERE fl.id = ?`,
      [req.params.id]
    );

    if (loans.length === 0) {
      return res.status(404).json({ error: 'Funded loan not found' });
    }

    const loan = loans[0];

    // Check access based on role + board access
    if (userGroup === 'admin' || userGroup === 'manager') {
      // Full access
    } else if (userGroup === 'processor') {
      const loIds = await getProcessorLOIds(userId);
      const boardIds = await getAccessibleBoardIds(userId);
      if (!loIds.includes(loan.assigned_lo_id) && !boardIds.includes(loan.source_board_id)) {
        return res.status(403).json({ error: 'Access denied to this loan' });
      }
    } else if (userGroup === 'lo') {
      const boardIds = await getAccessibleBoardIds(userId);
      if (!boardIds.includes(loan.source_board_id)) {
        return res.status(403).json({ error: 'Access denied to this loan' });
      }
    } else {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json({ data: loan });

  } catch (error) {
    next(error);
  }
});

// ========================================
// DELETE /api/funded-loans/:id
// Delete funded loan (Admin only)
// ========================================
router.delete('/:id', async (req, res, next) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Only admins can delete funded loans' });
    }

    const [loans] = await db.query('SELECT * FROM funded_loans WHERE id = ?', [req.params.id]);

    if (loans.length === 0) {
      return res.status(404).json({ error: 'Funded loan not found' });
    }

    await db.query('DELETE FROM funded_loans WHERE id = ?', [req.params.id]);

    res.json({
      success: true,
      message: 'Funded loan deleted',
      data: loans[0]
    });

  } catch (error) {
    next(error);
  }
});

// ========================================
// GET /api/funded-loans/by-lo/summary
// Get summary grouped by LO (Admin/Manager only)
// ========================================
router.get('/by-lo/summary', async (req, res, next) => {
  try {
    if (!isAdminOrManager(req)) {
      return res.status(403).json({ error: 'Admin or Manager access required' });
    }

    const { period } = req.query;
    const dateFilter = getDateFilter(period);

    const [summary] = await db.query(
      `SELECT
        fl.assigned_lo_id,
        fl.assigned_lo_name,
        u.email as lo_email,
        COUNT(*) as units,
        SUM(fl.loan_amount) as total_amount
       FROM funded_loans fl
       LEFT JOIN users u ON fl.assigned_lo_id = u.id
       WHERE fl.funded_date >= ? AND fl.funded_date <= ?
       GROUP BY fl.assigned_lo_id, fl.assigned_lo_name, u.email
       ORDER BY total_amount DESC`,
      [dateFilter.start, dateFilter.end]
    );

    res.json({
      data: summary,
      period: period || 'ytd'
    });

  } catch (error) {
    next(error);
  }
});

module.exports = router;
