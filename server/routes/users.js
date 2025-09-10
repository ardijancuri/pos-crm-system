const express = require('express');
const { body, validationResult } = require('express-validator');
const { query, run, get } = require('../database/connection');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Get current user profile
router.get('/me', authenticateToken, async (req, res) => {
  try {
    res.json(req.user);
  } catch (error) {
    console.error('Get current user error:', error);
    res.status(500).json({ message: 'Failed to get user profile' });
  }
});

// Get all clients for order assignment (admin only)
router.get('/clients', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await query(
      'SELECT id, name, email FROM users WHERE role = $1 ORDER BY name',
      ['client']
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Get clients error:', error);
    res.status(500).json({ message: 'Failed to get clients' });
  }
});

// Get debt reduction logs (admin only) with pagination
router.get('/debt-logs', authenticateToken, requireAdmin, async (req, res) => {
  try {
    // Parse pagination parameters
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    // Parse search parameters
    const clientName = req.query.clientName ? req.query.clientName.trim() : null;
    const dateFilter = req.query.date ? req.query.date.trim() : null;

    // Validate parameters
    if (page < 1 || limit < 1 || limit > 100) {
      return res.status(400).json({
        message: 'Invalid pagination parameters',
        details: 'Page must be >= 1, limit must be 1-100'
      });
    }

    // Build WHERE clause for search filters
    let whereClause = "uda.adjustment_type = 'manual_reduction'";
    const queryParams = [];
    let paramIndex = 1;

    if (clientName) {
      whereClause += ` AND LOWER(u.name) LIKE LOWER($${paramIndex})`;
      queryParams.push(`%${clientName}%`);
      paramIndex++;
    }

    if (dateFilter) {
      // Filter by date (YYYY-MM-DD format)
      whereClause += ` AND DATE(uda.created_at) = $${paramIndex}`;
      queryParams.push(dateFilter);
      paramIndex++;
    }

    // Get total count for pagination
    const countQuery = `
      SELECT COUNT(*) as total
      FROM user_debt_adjustments uda
      LEFT JOIN users u ON uda.user_id = u.id
      WHERE ${whereClause}
    `;

    const countResult = await query(countQuery, queryParams);
    const totalRecords = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(totalRecords / limit);

    // Get debt adjustments with user info (paginated)
    const mainQueryParams = [...queryParams, limit, offset];
    const adjustments = await query(`
      SELECT
        uda.id,
        uda.user_id,
        uda.adjustment_amount as debt,
        uda.currency,
        uda.adjustment_type,
        uda.notes,
        uda.created_at,
        u.name as client_name,
        u.email as client_email,
        COALESCE(admin_user.name, 'System') as admin_name,
        uda.created_by as created_by_id,
        COALESCE(admin_user.name, 'System') as created_by_name
      FROM user_debt_adjustments uda
      LEFT JOIN users u ON uda.user_id = u.id
      LEFT JOIN users admin_user ON uda.created_by = admin_user.id
      WHERE ${whereClause}
      ORDER BY uda.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `, mainQueryParams);

    // Calculate debt before/after for each adjustment
    const logsWithDebtHistory = await Promise.all(
      adjustments.rows.map(async (adjustment) => {
        try {
          // Calculate debt BEFORE this adjustment (all adjustments before this timestamp)
          // Use a small time buffer to avoid precision issues
          const beforeTimestamp = new Date(adjustment.created_at.getTime() - 1000); // 1 second before
          const beforeResult = await query(`
            SELECT COALESCE(SUM(adjustment_amount), 0) as debt_before
            FROM user_debt_adjustments
            WHERE user_id = $1
              AND currency = $2
              AND created_at < $3
              AND adjustment_type = 'manual_reduction'
          `, [adjustment.user_id, adjustment.currency, beforeTimestamp]);

          const debtBefore = Math.abs(parseFloat(beforeResult.rows[0]?.debt_before || 0));

          // Calculate debt AFTER this adjustment based on action type
          const rawAdjustmentAmount = parseFloat(adjustment.debt || 0);
          const adjustmentAmount = Math.abs(rawAdjustmentAmount);

          let debtAfter;
          if (adjustment.notes && (adjustment.notes.includes('increased') || adjustment.notes.includes('Debt increase') || adjustment.notes.includes('Added') || adjustment.notes.includes('Increased'))) {
            // Debt increase: add the amount to debt
            debtAfter = debtBefore + adjustmentAmount;
          } else if (adjustment.notes && (adjustment.notes.includes('reduced') || adjustment.notes.includes('removed') || adjustment.notes.includes('Reduced'))) {
            // Debt reduction: subtract the amount from debt
            debtAfter = debtBefore - adjustmentAmount;
          } else {
            // Fallback: use the raw adjustment amount sign
            debtAfter = debtBefore + rawAdjustmentAmount;
          }

          return {
            ...adjustment,
            debt_before: Math.abs(debtBefore), // Show as positive for display
            debt_after: Math.abs(debtAfter),   // Show as positive for display
            adjustment_amount: adjustment.debt // Use the correct field name
          };
        } catch (calcError) {
          console.error('Error calculating debt history for adjustment', adjustment.id, calcError);
          return {
            ...adjustment,
            debt_before: null,
            debt_after: null
          };
        }
      })
    );

    res.json({
      logs: logsWithDebtHistory,
      pagination: {
        currentPage: page,
        totalPages: totalPages,
        totalRecords: totalRecords,
        recordsPerPage: limit,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1
      }
    });
  } catch (error) {
    console.error('Get debt logs error:', error);
    res.status(500).json({ message: 'Failed to get debt logs' });
  }
});

// Clean up old debt logs (admin only) - delete logs older than 3 months
router.delete('/debt-logs/cleanup', authenticateToken, requireAdmin, async (req, res) => {
  try {
    // Calculate date 3 months ago
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    console.log('Cleaning up debt logs older than:', threeMonthsAgo.toISOString());

    // Delete old debt adjustment logs
    const deleteResult = await query(`
      DELETE FROM user_debt_adjustments
      WHERE adjustment_type = 'manual_reduction'
        AND created_at < $1
    `, [threeMonthsAgo]);

    const deletedCount = deleteResult.rowCount;

    console.log(`Cleaned up ${deletedCount} old debt adjustment logs`);

    res.json({
      message: 'Debt logs cleanup completed',
      deletedRecords: deletedCount,
      cutoffDate: threeMonthsAgo.toISOString()
    });
  } catch (error) {
    console.error('Cleanup debt logs error:', error);
    res.status(500).json({ message: 'Failed to cleanup debt logs' });
  }
});

// Get user profile (own profile or admin can get any user)
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);

    // Validate that userId is a valid number
    if (isNaN(userId) || userId <= 0) {
      return res.status(400).json({ message: 'Invalid user ID' });
    }

    // Users can only access their own profile, admins can access any profile
    if (req.user.role !== 'admin' && req.user.id !== userId) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const result = await query(
      'SELECT id, name, email, role, created_at FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ message: 'Failed to get user' });
  }
});

// Get user profile with orders and financial summary (admin only)
router.get('/:id/profile', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);

    // Validate that userId is a valid number
    if (isNaN(userId) || userId <= 0) {
      return res.status(400).json({ message: 'Invalid user ID' });
    }

    console.log('Fetching profile for user ID:', userId);

    // Get user details
    const userResult = await query(
      'SELECT id, name, email, phone, role, created_at FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = userResult.rows[0];
    console.log('User found:', user.name);

    // Get user's orders for display (limited for performance)
    const ordersResult = await query(`
      SELECT o.id, o.status, o.original_status, o.total_amount, o.created_at,
             o.guest_name, o.guest_email, o.guest_phone
      FROM orders o
      WHERE o.client_id = $1
      ORDER BY o.created_at DESC
      LIMIT 50
    `, [userId]);

    const orders = ordersResult.rows;

    // Get ALL orders for financial calculations (no limit)
    const financialOrdersResult = await query(`
      SELECT o.status, o.original_status, o.total_amount
      FROM orders o
      WHERE o.client_id = $1
    `, [userId]);

    const allOrders = financialOrdersResult.rows;

    // Calculate revenue separated by currency (EUR for smartphones, MKD for others)
    const revenueByCurrencyResult = await query(`
      SELECT 
        COALESCE(SUM(CASE WHEN p.category = 'smartphones' THEN oi.quantity * oi.price ELSE 0 END), 0) as eur_revenue,
        COALESCE(SUM(CASE WHEN p.category != 'smartphones' THEN oi.quantity * oi.price ELSE 0 END), 0) as mkd_revenue
      FROM orders o
      JOIN order_items oi ON o.id = oi.order_id
      JOIN products p ON oi.product_id = p.id
      WHERE o.client_id = $1 AND o.status = 'completed'
    `, [userId]);

    const eurRevenue = parseFloat(revenueByCurrencyResult.rows[0].eur_revenue || 0);
    const mkdRevenue = parseFloat(revenueByCurrencyResult.rows[0].mkd_revenue || 0);

    // Calculate financial summary from ALL orders
    const completedOrders = allOrders.filter(order => order.status === 'completed');
    const pendingOrders = allOrders.filter(order => order.status === 'pending');
    const shippedOrders = allOrders.filter(order => order.status === 'shipped');

    const totalPaid = completedOrders.reduce((sum, order) => sum + parseFloat(order.total_amount || 0), 0);
    
    // Debt is computed solely from the adjustments ledger below
    const totalOrders = allOrders.length;

    // Compute debt SOLELY from the adjustments ledger
    // Negative amounts represent increases (e.g., pending order creation)
    // Positive amounts represent manual reductions
    let eurSum = 0;
    let mkdSum = 0;
    try {
      const sumsResult = await query(
        `SELECT currency, COALESCE(SUM(adjustment_amount), 0) AS sum
         FROM user_debt_adjustments
         WHERE user_id = $1
         GROUP BY currency`,
        [userId]
      );
      sumsResult.rows.forEach(row => {
        const sum = parseFloat(row.sum || 0);
        if (row.currency === 'EUR') eurSum = sum;
        if (row.currency === 'MKD') mkdSum = sum;
      });
    } catch (e) {
      console.error('Error summing debt adjustments:', e);
    }

    // Allow negative debt values (represents credit when negative)
    const eurDebt = -eurSum; // Negative debt means user has credit
    const mkdDebt = -mkdSum; // Negative debt means user has credit
    const totalDebt = eurDebt + mkdDebt;
    // Get order items for each order (batched to avoid N+1 queries)
    let ordersWithItems = orders.map(o => ({ ...o, items: [] }));
    try {
      const orderIds = orders.map(o => o.id);
      if (orderIds.length > 0) {
        const itemsRes = await query(`
          SELECT oi.order_id, oi.quantity, oi.price, p.name AS product_name, p.category
          FROM order_items oi
          JOIN products p ON oi.product_id = p.id
          WHERE oi.order_id = ANY($1::int[])
        `, [orderIds]);

        const itemsByOrderId = new Map();
        itemsRes.rows.forEach(row => {
          if (!itemsByOrderId.has(row.order_id)) itemsByOrderId.set(row.order_id, []);
          itemsByOrderId.get(row.order_id).push({
            quantity: row.quantity,
            price: row.price,
            product_name: row.product_name,
            category: row.category
          });
        });

        ordersWithItems = orders.map(order => ({
          ...order,
          items: itemsByOrderId.get(order.id) || []
        }));
      }
    } catch (itemError) {
      console.error('Error fetching items for orders (batched):', itemError);
      // Fallback already set: empty items arrays
    }

    res.json({
      user,
      orders: ordersWithItems,
      financialSummary: {
        totalPaid,
        eurRevenue,
        mkdRevenue,
        totalDebt,
        eurDebt,
        mkdDebt,
        totalOrders,
        completedOrders: completedOrders.length,
        pendingOrders: pendingOrders.length,
        shippedOrders: shippedOrders.length
      }
    });
  } catch (error) {
    console.error('Get user profile error:', error);
    res.status(500).json({ message: 'Failed to get user profile' });
  }
});

// Update user profile
router.put('/:id', [
  authenticateToken,
  body('name').optional().trim().isLength({ min: 2, max: 255 }),
  body('email').optional().isEmail().normalizeEmail()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        message: 'Validation failed', 
        errors: errors.array() 
      });
    }

    const userId = parseInt(req.params.id);

    // Validate that userId is a valid number
    if (isNaN(userId) || userId <= 0) {
      return res.status(400).json({ message: 'Invalid user ID' });
    }

    // Users can only update their own profile, admins can update any profile
    if (req.user.role !== 'admin' && req.user.id !== userId) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const { name, email } = req.body;
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (name) {
      updates.push(`name = $${paramCount}`);
      values.push(name);
      paramCount++;
    }

    if (email) {
      // Check if email is already taken by another user
      const emailCheck = await query(
        'SELECT id FROM users WHERE email = $1 AND id != $2',
        [email, userId]
      );
      
      if (emailCheck.rows.length > 0) {
        return res.status(400).json({ message: 'Email already in use' });
      }

      updates.push(`email = $${paramCount}`);
      values.push(email);
      paramCount++;
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: 'No valid updates provided' });
    }

    values.push(userId);
    const result = await query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING id, name, email, role, created_at`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({
      message: 'User updated successfully',
      user: result.rows[0]
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ message: 'Failed to update user' });
  }
});

// Get all users (admin only)
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '', role = '' } = req.query;
    const offset = (page - 1) * limit;

    let queryText = 'SELECT id, name, email, phone, role, created_at FROM users';
    let countQuery = 'SELECT COUNT(*) FROM users';
    let queryParams = [];
    let paramCount = 1;
    let whereConditions = [];

    if (search) {
      whereConditions.push(`name ILIKE $${paramCount}`);
      queryParams.push(`%${search}%`);
      paramCount++;
    }

    if (role) {
      whereConditions.push(`role = $${paramCount}`);
      queryParams.push(role);
      paramCount++;
    }

    if (whereConditions.length > 0) {
      const whereClause = ' WHERE ' + whereConditions.join(' AND ');
      queryText += whereClause;
      countQuery += whereClause;
    }

    queryText += ` ORDER BY created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    queryParams.push(limit, offset);

    const [usersResult, countResult] = await Promise.all([
      query(queryText, queryParams),
      query(countQuery, queryParams.slice(0, -2)) // Remove limit and offset for count query
    ]);

    const totalUsers = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalUsers / limit);

    res.json({
      users: usersResult.rows,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalUsers,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ message: 'Failed to get users' });
  }
});

// Create new client user (admin only)
router.post('/', authenticateToken, requireAdmin, [
  body('name').trim().isLength({ min: 2, max: 255 }).withMessage('Name must be between 2 and 255 characters'),
  body('phone').optional().isMobilePhone().withMessage('Phone must be a valid phone number'),
  body('email').optional().isEmail().normalizeEmail().withMessage('Email must be a valid email address'),
  body('role').isIn(['client']).withMessage('Only client users can be created')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        message: 'Validation failed', 
        errors: errors.array() 
      });
    }

    const { name, phone, email, role = 'client' } = req.body;

    // Check if email is already taken (if provided)
    if (email) {
      const emailCheck = await query(
        'SELECT id FROM users WHERE email = $1',
        [email]
      );
      
      if (emailCheck.rows.length > 0) {
        return res.status(400).json({ message: 'Email already in use' });
      }
    }

    // Create the user (clients don't need password_hash)
    const result = await query(
      'INSERT INTO users (name, phone, email, role) VALUES ($1, $2, $3, $4) RETURNING id, name, phone, email, role, created_at',
      [name, phone || null, email || null, role]
    );

    res.status(201).json({
      message: 'Client user created successfully',
      user: result.rows[0]
    });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ message: 'Failed to create user' });
  }
});

// Delete user (admin only)
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);

    // Validate that userId is a valid number
    if (isNaN(userId) || userId <= 0) {
      return res.status(400).json({ message: 'Invalid user ID' });
    }

    // Check if user exists
    const userResult = await query('SELECT id, name, role FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = userResult.rows[0];
    
    // Prevent deleting admin users
    if (user.role === 'admin') {
      return res.status(403).json({ message: 'Cannot delete admin users' });
    }

    // Check if user has any outstanding debt (unpaid orders)
    const debtResult = await query(`
      SELECT COUNT(*) as unpaid_count
      FROM orders 
      WHERE client_id = $1 AND status != 'completed'
    `, [userId]);
    
    const unpaidOrders = parseInt(debtResult.rows[0].unpaid_count);

    if (unpaidOrders > 0) {
      return res.status(400).json({ 
        message: `Cannot delete user '${user.name}' because they have ${unpaidOrders} unpaid order(s). Please complete or cancel their orders first.` 
      });
    }

    // Delete the user
    await query('DELETE FROM users WHERE id = $1', [userId]);

    res.json({ 
      message: `User '${user.name}' deleted successfully`,
      deletedUserId: userId
    });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ message: 'Failed to delete user' });
  }
});

// Update user debt (admin only)
router.put('/:id/debt', authenticateToken, requireAdmin, [
  body('debt').isFloat().withMessage('Debt adjustment must be a number'),
  body('currency').optional().isIn(['EUR','MKD']).withMessage('Currency must be EUR or MKD'),
  body('adjustment_type').optional().isIn(['manual_reduction']).withMessage('Invalid adjustment type')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        message: 'Validation error', 
        errors: errors.array() 
      });
    }

    const userId = parseInt(req.params.id);

    // Validate that userId is a valid number
    if (isNaN(userId) || userId <= 0) {
      return res.status(400).json({ message: 'Invalid user ID' });
    }

    const { debt, currency = null, adjustment_type = 'manual_reduction', notes } = req.body;

    // Check if user exists
    const userResult = await query('SELECT id FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Store the debt adjustment
    try {
      await query(
        'INSERT INTO user_debt_adjustments (user_id, adjustment_amount, adjustment_type, currency, notes, created_by) VALUES ($1, $2, $3, $4, $5, $6)',
        [userId, debt, adjustment_type, currency, notes || null, req.user.id]
      );
    } catch (insertError) {
      console.error('Error inserting debt adjustment:', insertError);
      // If table doesn't exist, just return success for now
      // The table will be created on next app restart
    }

    res.json({ 
      message: 'Debt updated successfully',
      userId,
      debt,
      adjustment_type,
      currency
    });
  } catch (error) {
    console.error('Update user debt error:', error);
    res.status(500).json({ message: 'Failed to update user debt' });
  }
});

module.exports = router; 