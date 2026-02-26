// Funded Loans API Routes
// Query funded loans with YTD/MTD filters, role-based access

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
  // Return the highest priority group (first one, since Cognito sorts by precedence)
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
 * Build date filter for YTD or MTD
 */
function getDateFilter(period) {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  
  if (period === 'ytd') {
    return {
      start: `${year}-01-01`,
      end: `${year}-12-31`
    };
  } else if (period === 'mtd') {
    const lastDay = new Date(year, now.getMonth() + 1, 0).getDate();
    return {
      start: `${year}-${month}-01`,
      end: `${year}-${month}-${lastDay}`
    };
  } else if (period) {
    // Custom period: expect YYYY-MM format
    const [customYear, customMonth] = period.split('-');
    if (customYear && customMonth) {
      const lastDay = new Date(parseInt(customYear), parseInt(customMonth), 0).getDate();
      return {
        start: `${customYear}-${customMonth}-01`,
        end: `${customYear}-${customMonth}-${lastDay}`
      };
    }
  }
  
  // Default to YTD
  return {
    start: `${year}-01-01`,
    end: `${year}-12-31`
  };
}

// ========================================
// GET /api/funded-loans
// Query funded loans with filtering
// ========================================
router.get('/', async (req, res, next) => {
  try {
    const { period, lo_id, group, start_date, end_date } = req.query;
    const userGroup = getUserGroup(req);
    const userId = req.user?.db?.id;

    let whereClause = 'WHERE 1=1';
    const params = [];

    // ========================================
    // ROLE-BASED DATA FILTERING
    // ========================================

    if (userGroup === 'admin' || userGroup === 'manager') {
      // Admin/Manager: See all funded loans
      // Optional filter by specific LO
      if (lo_id) {
        whereClause += ' AND fl.assigned_lo_id = ?';
        params.push(lo_id);
      }
    } else if (userGroup === 'processor') {
      // Processor: See only loans from their assigned LOs
      const loIds = await getProcessorLOIds(userId);

      if (loIds.length === 0) {
        // No LOs assigned, return empty
        return res.json({ data: [], summary: { count: 0, total_amount: 0 }, groups: [] });
      }

      whereClause += ` AND fl.assigned_lo_id IN (${loIds.map(() => '?').join(',')})`;
      params.push(...loIds);
    } else if (userGroup === 'lo') {
      // LO: See only their own loans
      whereClause += ' AND fl.assigned_lo_id = ?';
      params.push(userId);
    } else {
      // External or unknown: No access to funded loans
      return res.status(403).json({ error: 'Access denied to funded loans' });
    }

    // ========================================
    // DATE FILTERING
    // ========================================

    if (start_date && end_date) {
      // Custom date range
      whereClause += ' AND fl.funded_date >= ? AND fl.funded_date <= ?';
      params.push(start_date, end_date);
    } else {
      // Use period filter (ytd, mtd, or YYYY-MM)
      const dateFilter = getDateFilter(period);
      whereClause += ' AND fl.funded_date >= ? AND fl.funded_date <= ?';
      params.push(dateFilter.start, dateFilter.end);
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
        u.email as lo_email
       FROM funded_loans fl
       LEFT JOIN users u ON fl.assigned_lo_id = u.id
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

    res.json({
      data: loans,
      summary: {
        count: summary[0].count,
        total_amount: parseFloat(summary[0].total_amount) || 0
      },
      groups,
      filters: {
        period: period || 'ytd',
        lo_id: lo_id || null,
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
    const { period, lo_id } = req.query;
    const userGroup = getUserGroup(req);
    const userId = req.user?.db?.id;
    
    let whereClause = 'WHERE 1=1';
    const params = [];
    
    // Role-based filtering (same as above)
    if (userGroup === 'admin' || userGroup === 'manager') {
      if (lo_id) {
        whereClause += ' AND assigned_lo_id = ?';
        params.push(lo_id);
      }
    } else if (userGroup === 'processor') {
      const loIds = await getProcessorLOIds(userId);
      if (loIds.length === 0) {
        return res.json({ units: 0, total_amount: 0 });
      }
      whereClause += ` AND assigned_lo_id IN (${loIds.map(() => '?').join(',')})`;
      params.push(...loIds);
    } else if (userGroup === 'lo') {
      whereClause += ' AND assigned_lo_id = ?';
      params.push(userId);
    } else {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    // Date filtering
    const dateFilter = getDateFilter(period);
    whereClause += ' AND funded_date >= ? AND funded_date <= ?';
    params.push(dateFilter.start, dateFilter.end);
    
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
      period: period || 'ytd'
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
    
    // Check access based on role
    if (userGroup === 'admin' || userGroup === 'manager') {
      // Full access
    } else if (userGroup === 'processor') {
      const loIds = await getProcessorLOIds(userId);
      if (!loIds.includes(loan.assigned_lo_id)) {
        return res.status(403).json({ error: 'Access denied to this loan' });
      }
    } else if (userGroup === 'lo') {
      if (loan.assigned_lo_id !== userId) {
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
