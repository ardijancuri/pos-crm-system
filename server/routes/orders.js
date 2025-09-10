const express = require('express');
const { body, validationResult } = require('express-validator');
const { query, run, get, pool } = require('../database/connection');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

// Helper function to check if items actually changed
function checkItemsChanged(originalItems, newItems) {
  // If lengths are different, items changed
  if (originalItems.length !== newItems.length) {
    return true;
  }

  // Create maps for comparison
  const originalMap = new Map();
  const newMap = new Map();

  // Build maps with productId as key and quantity as value
  originalItems.forEach(item => {
    originalMap.set(item.productId || item.product_id, item.quantity);
  });

  newItems.forEach(item => {
    newMap.set(item.productId, item.quantity);
  });

  // Check if all items in original exist in new with same quantities
  for (const [productId, originalQty] of originalMap) {
    const newQty = newMap.get(productId);
    if (newQty === undefined || newQty !== originalQty) {
      return true; // Item was removed, added, or quantity changed
    }
  }

  // Check if all items in new exist in original
  for (const [productId, newQty] of newMap) {
    const originalQty = originalMap.get(productId);
    if (originalQty === undefined) {
      return true; // New item was added
    }
  }

  return false; // No changes detected
}

// Helper function to calculate net debt change and generate appropriate notes
async function calculateNetDebtChange(client, originalItems, newItems, orderId, clientId) {
  let eurNetChange = 0;
  let mkdNetChange = 0;

  const addedItems = [];
  const removedItems = [];
  const quantityChanges = [];

  // Create maps for efficient lookup
  const originalMap = new Map();
  const newMap = new Map();

  // Build original items map
  originalItems.forEach(item => {
    const productId = item.productId || item.product_id;
    originalMap.set(productId, {
      quantity: item.quantity,
      price: item.price,
      name: item.name || item.product_name
    });
  });

  // Build new items map
  newItems.forEach(item => {
    newMap.set(item.productId, {
      quantity: item.quantity,
      price: item.price,
      name: item.name || item.product_name
    });
  });

  // Find added items and quantity increases
  for (const [productId, newItem] of newMap) {
    const originalItem = originalMap.get(productId);

    if (!originalItem) {
      // Item was added
      addedItems.push({
        productId,
        name: newItem.name,
        quantity: newItem.quantity,
        price: newItem.price
      });
    } else if (newItem.quantity > originalItem.quantity) {
      // Quantity increased
      const increaseQty = newItem.quantity - originalItem.quantity;
      quantityChanges.push({
        productId,
        name: newItem.name,
        increase: increaseQty,
        price: newItem.price
      });
    }
  }

  // Find removed items and quantity decreases
  for (const [productId, originalItem] of originalMap) {
    const newItem = newMap.get(productId);

    if (!newItem) {
      // Item was removed
      removedItems.push({
        productId,
        name: originalItem.name,
        quantity: originalItem.quantity,
        price: originalItem.price
      });
    } else if (newItem.quantity < originalItem.quantity) {
      // Quantity decreased
      const decreaseQty = originalItem.quantity - newItem.quantity;
      quantityChanges.push({
        productId,
        name: originalItem.name,
        decrease: decreaseQty,
        price: originalItem.price
      });
    }
  }

  // Calculate net debt changes
  for (const item of addedItems) {
    const productResult = await client.query('SELECT category FROM products WHERE id = $1', [item.productId]);
    const category = productResult.rows[0]?.category;
    const itemTotal = item.quantity * item.price;

    if (category === 'smartphones') {
      eurNetChange += itemTotal; // Positive = debt increase
    } else {
      mkdNetChange += itemTotal; // Positive = debt increase
    }
  }

  for (const item of removedItems) {
    const productResult = await client.query('SELECT category FROM products WHERE id = $1', [item.productId]);
    const category = productResult.rows[0]?.category;
    const itemTotal = item.quantity * item.price;

    if (category === 'smartphones') {
      eurNetChange -= itemTotal; // Negative = debt reduction
    } else {
      mkdNetChange -= itemTotal; // Negative = debt reduction
    }
  }

  for (const item of quantityChanges) {
    const productResult = await client.query('SELECT category FROM products WHERE id = $1', [item.productId]);
    const category = productResult.rows[0]?.category;

    if (item.increase) {
      const itemTotal = item.increase * item.price;
      if (category === 'smartphones') {
        eurNetChange += itemTotal;
      } else {
        mkdNetChange += itemTotal;
      }
    } else if (item.decrease) {
      const itemTotal = item.decrease * item.price;
      if (category === 'smartphones') {
        eurNetChange -= itemTotal;
      } else {
        mkdNetChange -= itemTotal;
      }
    }
  }

  // Generate comprehensive notes with both action and details
  const noteParts = [];
  let actionType = '';

  if (addedItems.length > 0 && removedItems.length === 0 && quantityChanges.length === 0) {
    actionType = `Items increased in order #${orderId}`;
    const addedNames = addedItems.map(item => `${item.name} (x${item.quantity})`).join(', ');
    noteParts.push(`${actionType}. Added: ${addedNames}`);
  } else if (removedItems.length > 0 && addedItems.length === 0 && quantityChanges.length === 0) {
    actionType = `Items reduced from order #${orderId}`;
    const removedNames = removedItems.map(item => `${item.name} (x${item.quantity})`).join(', ');
    noteParts.push(`${actionType}. Removed: ${removedNames}`);
  } else if (quantityChanges.length > 0 && addedItems.length === 0 && removedItems.length === 0) {
    actionType = `Items quantity updated in order #${orderId}`;
    const changeNames = quantityChanges.map(item => {
      if (item.increase) {
        return `${item.name} (+${item.increase})`;
      } else {
        return `${item.name} (-${item.decrease})`;
      }
    }).join(', ');
    noteParts.push(`${actionType}. Quantity changes: ${changeNames}`);
  } else if ((addedItems.length > 0 || removedItems.length > 0 || quantityChanges.length > 0)) {
    // Mixed changes
    const changes = [];
    if (addedItems.length > 0) changes.push('increased');
    if (removedItems.length > 0) changes.push('reduced');
    if (quantityChanges.length > 0) changes.push('quantity updated');
    actionType = `Items ${changes.join(' and ')} in order #${orderId}`;

    // Add details for each type of change
    if (addedItems.length > 0) {
      const addedNames = addedItems.map(item => `${item.name} (x${item.quantity})`).join(', ');
      noteParts.push(`Increased: ${addedNames}`);
    }
    if (removedItems.length > 0) {
      const removedNames = removedItems.map(item => `${item.name} (x${item.quantity})`).join(', ');
      noteParts.push(`Reduced: ${removedNames}`);
    }
    if (quantityChanges.length > 0) {
      const changeNames = quantityChanges.map(item => {
        if (item.increase) {
          return `${item.name} (+${item.increase})`;
        } else {
          return `${item.name} (-${item.decrease})`;
        }
      }).join(', ');
      noteParts.push(`Quantity changes: ${changeNames}`);
    }

    noteParts.unshift(actionType); // Add action type at the beginning
  }

  const noteText = noteParts.length > 0 ? noteParts.join('. ') : 'Order items updated';

  return {
    eurNetChange,
    mkdNetChange,
    noteDetails: {
      eurNote: noteText,
      mkdNote: noteText
    }
  };
}
const PDFDocument = require('pdfkit');

const router = express.Router();

// Get orders (admin: all orders, client: own orders)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 10, status = '', search = '', sortBy = 'created_at', sortOrder = 'desc' } = req.query;
    const offset = (page - 1) * limit;
    const isAdmin = req.user.role === 'admin';

    let queryText = `
      SELECT o.id, o.status, o.total_amount, o.created_at,
             u.name as client_name, u.email as client_email,
             o.guest_name, o.guest_email, o.guest_phone,
             COALESCE(eur_totals.eur_total, 0) as eur_total,
             COALESCE(mkd_totals.mkd_total, 0) as mkd_total,
             COALESCE(eur_totals.eur_total, 0) + COALESCE(mkd_totals.mkd_total, 0) as original_total,
             CASE 
               WHEN COALESCE(eur_totals.eur_total, 0) + COALESCE(mkd_totals.mkd_total, 0) > o.total_amount 
               THEN COALESCE(eur_totals.eur_total, 0) + COALESCE(mkd_totals.mkd_total, 0) - o.total_amount
               ELSE 0 
             END as discount_amount
      FROM orders o
      LEFT JOIN users u ON o.client_id = u.id
      LEFT JOIN (
        SELECT oi.order_id, 
               SUM(oi.quantity * oi.price) as eur_total
        FROM order_items oi
        JOIN products p ON oi.product_id = p.id
        WHERE p.category = 'smartphones'
        GROUP BY oi.order_id
      ) eur_totals ON o.id = eur_totals.order_id
      LEFT JOIN (
        SELECT oi.order_id, 
               SUM(oi.quantity * oi.price) as mkd_total
        FROM order_items oi
        JOIN products p ON oi.product_id = p.id
        WHERE p.category != 'smartphones'
        GROUP BY oi.order_id
      ) mkd_totals ON o.id = mkd_totals.order_id
    `;
    let countQuery = `
      SELECT COUNT(*) 
      FROM orders o
      LEFT JOIN users u ON o.client_id = u.id
    `;
    let queryParams = [];
    let paramCount = 1;
    let whereConditions = [];

    // Client can only see their own orders
    if (!isAdmin) {
      whereConditions.push(`o.client_id = $${paramCount}`);
      queryParams.push(req.user.id);
      paramCount++;
    }

    // Status filter
    if (status && ['pending', 'completed'].includes(status)) {
      whereConditions.push(`o.status = $${paramCount}`);
      queryParams.push(status);
      paramCount++;
    }

    // Search filter
    if (search && search.trim()) {
      whereConditions.push(`(o.id::text ILIKE $${paramCount} OR u.name ILIKE $${paramCount} OR u.email ILIKE $${paramCount})`);
      queryParams.push(`%${search.trim()}%`);
      paramCount++;
    }

    // Add WHERE clause if conditions exist
    if (whereConditions.length > 0) {
      const whereClause = whereConditions.join(' AND ');
      queryText += ` WHERE ${whereClause}`;
      countQuery += ` WHERE ${whereClause}`;
    }

    // Validate sort parameters
    const validSortFields = ['created_at', 'total_amount', 'status'];
    const validSortOrders = ['asc', 'desc'];
    
    if (!validSortFields.includes(sortBy)) sortBy = 'created_at';
    if (!validSortOrders.includes(sortOrder)) sortOrder = 'desc';

    queryText += ` ORDER BY o.${sortBy} ${sortOrder.toUpperCase()} LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    queryParams.push(limit, offset);

    const [ordersResult, countResult] = await Promise.all([
      query(queryText, queryParams),
      query(countQuery, whereConditions.length > 0 ? queryParams.slice(0, -2) : [])
    ]);

    const totalOrders = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalOrders / limit);

    res.json({
      orders: ordersResult.rows,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalOrders,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    });
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({ message: 'Failed to get orders' });
  }
});

// Get total revenue from all completed orders (separated by currency)
router.get('/revenue', authenticateToken, async (req, res) => {
  try {
    const result = await query(`
      SELECT 
        COALESCE(SUM(CASE WHEN p.category = 'smartphones' THEN oi.quantity * oi.price ELSE 0 END), 0) as eur_revenue,
        COALESCE(SUM(CASE WHEN p.category != 'smartphones' THEN oi.quantity * oi.price ELSE 0 END), 0) as mkd_revenue
      FROM orders o
      JOIN order_items oi ON o.id = oi.order_id
      JOIN products p ON oi.product_id = p.id
      WHERE o.status = 'completed'
    `);
    
    res.json({
      eurRevenue: parseFloat(result.rows[0].eur_revenue),
      mkdRevenue: parseFloat(result.rows[0].mkd_revenue),
      totalRevenue: parseFloat(result.rows[0].eur_revenue) + parseFloat(result.rows[0].mkd_revenue)
    });
  } catch (error) {
    console.error('Get revenue error:', error);
    res.status(500).json({ message: 'Failed to get revenue' });
  }
});

// Get single order with items
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const isAdmin = req.user.role === 'admin';

    // Get order details
    let orderQuery = `
      SELECT o.id, o.status, o.total_amount, o.created_at,
             o.discount_amount, o.discount_currency, o.original_total,
             u.name as client_name, u.email as client_email,
             o.guest_name, o.guest_email, o.guest_phone
      FROM orders o
      LEFT JOIN users u ON o.client_id = u.id
      WHERE o.id = $1
    `;
    let orderParams = [orderId];

    // Client can only see their own orders
    if (!isAdmin) {
      orderQuery += ' AND o.client_id = $2';
      orderParams.push(req.user.id);
    }

    const orderResult = await query(orderQuery, orderParams);

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Get order items
    const itemsResult = await query(`
      SELECT oi.quantity, oi.price,
             p.id as product_id, p.name as product_name, p.description, p.category,
             p.imei, p.barcode
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = $1
    `, [orderId]);

    const order = orderResult.rows[0];
    order.items = itemsResult.rows;

    res.json(order);
  } catch (error) {
    console.error('Get order error:', error);
    res.status(500).json({ message: 'Failed to get order' });
  }
});

// Create order (client or admin for guest)
router.post('/', [
  authenticateToken,
  body('items').isArray({ min: 1 }),
  body('items.*.productId').isInt({ min: 1 }),
  body('items.*.quantity').isInt({ min: 1 }),
  body('guestName').optional().isString().trim().isLength({ min: 1 }),
  body('guestEmail').optional().isEmail(),
  body('guestPhone').optional().isString().trim(),
  body('clientId').optional().isInt({ min: 1 }),
  body('status').optional().isIn(['pending', 'completed']).withMessage('Status must be pending or completed')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        message: 'Validation failed', 
        errors: errors.array() 
      });
    }

    const { items, guestName, guestEmail, guestPhone, clientId: requestedClientId, status = 'pending', discount = 0, discountCurrency = 'EUR', totalMkd = 0, totalEur = 0, originalMkd = 0, originalEur = 0 } = req.body;
    const isAdmin = req.user.role === 'admin';
    let clientId = req.user.id;
    let guestInfo = null;

    // Handle client order assignment (admin only)
    if (requestedClientId) {
      if (!isAdmin) {
        return res.status(403).json({ message: 'Only admins can assign orders to other clients' });
      }
      clientId = requestedClientId;
    }

    // Handle guest order (admin only). Allow name-only guests; email/phone optional
    if (guestName) {
      if (!isAdmin) {
        return res.status(403).json({ message: 'Only admins can create guest orders' });
      }
      clientId = null;
      guestInfo = { guestName, guestEmail: guestEmail || '', guestPhone: guestPhone || null };
    }

    // Validate products and calculate totals
    let totalAmount = 0;
    let eurPendingTotal = 0; // Sum of smartphone items (EUR)
    let mkdPendingTotal = 0; // Sum of non-smartphone items (MKD)
    const validatedItems = [];

    for (const item of items) {
      const productResult = await query(
        'SELECT id, name, price, stock_status, stock_quantity, category FROM products WHERE id = $1',
        [item.productId]
      );

      if (productResult.rows.length === 0) {
        return res.status(400).json({ message: `Product ${item.productId} not found` });
      }

      const product = productResult.rows[0];

      if (product.stock_status === 'disabled') {
        return res.status(400).json({ message: `Product ${product.name} is not available` });
      }

      if (product.stock_quantity < item.quantity) {
        return res.status(400).json({ message: `Insufficient stock for ${product.name}` });
      }

      const lineTotal = product.price * item.quantity;
      totalAmount += lineTotal;

      // Track totals by currency based on category
      if (product.category === 'smartphones') {
        eurPendingTotal += lineTotal;
      } else {
        mkdPendingTotal += lineTotal;
      }
      validatedItems.push({
        productId: product.id,
        quantity: item.quantity,
        price: product.price,
        name: product.name,
        category: product.category
      });
    }

    // Use discounted totals if provided, otherwise use calculated totals
    const finalTotalAmount = (totalEur > 0 ? totalEur : eurPendingTotal) + (totalMkd > 0 ? totalMkd : mkdPendingTotal);
    
    // Create order
    let orderResult;
    if (guestInfo) {
      // Guest order
      orderResult = await query(
        'INSERT INTO orders (client_id, guest_name, guest_email, guest_phone, total_amount, discount_amount, discount_currency, original_total, status, original_status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id',
        [clientId, guestInfo.guestName, guestInfo.guestEmail, guestInfo.guestPhone, finalTotalAmount, discount, discountCurrency, totalAmount, status, status]
      );
    } else {
      // Client order
      orderResult = await query(
        'INSERT INTO orders (client_id, total_amount, discount_amount, discount_currency, original_total, status, original_status) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
        [clientId, finalTotalAmount, discount, discountCurrency, totalAmount, status, status]
      );
    }
    


    const orderId = orderResult.rows[0].id;

    // Create order items and update stock
    for (const item of validatedItems) {
      await query(
        'INSERT INTO order_items (order_id, product_id, quantity, price) VALUES ($1, $2, $3, $4)',
        [orderId, item.productId, item.quantity, item.price]
      );

      // Update stock quantity
      await query(
        'UPDATE products SET stock_quantity = stock_quantity - $1 WHERE id = $2',
        [item.quantity, item.productId]
      );
    }

    // Record debt increase ONLY when a pending order is created for a client
    if (!guestInfo && clientId && status === 'pending') {
      const notes = `Debt increase from pending order #${orderId}${discount > 0 ? ` (Discount: ${discount} ${totalEur > 0 && totalMkd === 0 ? 'EUR' : totalMkd > 0 && totalEur === 0 ? 'MKD' : 'MKD/EUR'})` : ''}`;
      
      // Use discounted totals for debt calculation if provided, otherwise fall back to calculated totals
      const finalEurTotal = totalEur > 0 ? totalEur : eurPendingTotal;
      const finalMkdTotal = totalMkd > 0 ? totalMkd : mkdPendingTotal;
      
      // Use negative amount to represent increase; positive amounts are manual reductions
      if (finalEurTotal > 0) {
        await query(
          'INSERT INTO user_debt_adjustments (user_id, adjustment_amount, adjustment_type, currency, notes, created_by) VALUES ($1, $2, $3, $4, $5, $6)',
          [clientId, -finalEurTotal, 'manual_reduction', 'EUR', notes, req.user.id]
        );
      }
      if (finalMkdTotal > 0) {
        await query(
          'INSERT INTO user_debt_adjustments (user_id, adjustment_amount, adjustment_type, currency, notes, created_by) VALUES ($1, $2, $3, $4, $5, $6)',
          [clientId, -finalMkdTotal, 'manual_reduction', 'MKD', notes, req.user.id]
        );
      }
    }

    res.status(201).json({
      message: 'Order created successfully',
      orderId,
      totalAmount: finalTotalAmount,
      originalTotal: totalAmount,
      discount: discount > 0 ? discount : 0,
      eurTotal: totalEur > 0 ? totalEur : eurPendingTotal,
      mkdTotal: totalMkd > 0 ? totalMkd : mkdPendingTotal
    });
  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({ message: 'Failed to create order' });
  }
});

// Update order status (admin only)
router.put('/:id/status', [
  authenticateToken,
  requireAdmin,
  body('status').isIn(['pending', 'completed'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        message: 'Validation failed', 
        errors: errors.array() 
      });
    }

    const orderId = parseInt(req.params.id);
    const { status } = req.body;

    const result = await query(
      'UPDATE orders SET status = $1 WHERE id = $2 RETURNING id, status',
      [status, orderId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Order not found' });
    }

    res.json({
      message: 'Order status updated successfully',
      order: result.rows[0]
    });
  } catch (error) {
    console.error('Update order status error:', error);
    res.status(500).json({ message: 'Failed to update order status' });
  }
});

// Generate PDF invoice
router.get('/:id/invoice', authenticateToken, async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const isAdmin = req.user.role === 'admin';

    // Get order details
    let orderQuery = `
      SELECT o.id, o.status, o.total_amount, o.created_at,
             o.discount_amount, o.discount_currency, o.original_total,
             u.name as client_name, u.email as client_email,
             o.guest_name, o.guest_email, o.guest_phone,
             COALESCE(eur_debt.total_eur_debt, 0) as client_eur_debt,
             COALESCE(mkd_debt.total_mkd_debt, 0) as client_mkd_debt
      FROM orders o
      LEFT JOIN users u ON o.client_id = u.id
      LEFT JOIN (
        SELECT user_id, ABS(SUM(CASE WHEN adjustment_amount IS NOT NULL THEN adjustment_amount ELSE 0 END)) as total_eur_debt
        FROM user_debt_adjustments 
        WHERE currency = 'EUR' 
        GROUP BY user_id
      ) eur_debt ON u.id = eur_debt.user_id
      LEFT JOIN (
        SELECT user_id, ABS(SUM(CASE WHEN adjustment_amount IS NOT NULL THEN adjustment_amount ELSE 0 END)) as total_mkd_debt
        FROM user_debt_adjustments 
        WHERE currency = 'MKD' 
        GROUP BY user_id
      ) mkd_debt ON u.id = mkd_debt.user_id
      WHERE o.id = $1
    `;
    let orderParams = [orderId];

    // Client can only download their own invoices
    if (!isAdmin) {
      orderQuery += ' AND o.client_id = $2';
      orderParams.push(req.user.id);
    }

    const orderResult = await query(orderQuery, orderParams);

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ message: 'Order not found' });
    }

    const order = orderResult.rows[0];
    
    // Ensure required fields have default values to prevent PDF generation errors
    order.discount_amount = order.discount_amount || 0;
    order.original_total = order.original_total || 0;
    order.total_amount = order.total_amount || 0;
    order.client_eur_debt = parseFloat(order.client_eur_debt || 0);
    order.client_mkd_debt = parseFloat(order.client_mkd_debt || 0);
    
    console.log('Order data for invoice:', {
      id: order.id,
      total_amount: order.total_amount,
      discount_amount: order.discount_amount,
      original_total: order.original_total,
      client_name: order.client_name,
      client_eur_debt: order.client_eur_debt,
      client_mkd_debt: order.client_mkd_debt
    });

    // Get order items
    const itemsResult = await query(`
      SELECT oi.quantity, oi.price,
             p.name as product_name, p.description, p.category, p.subcategory, p.model, p.storage_gb, p.color
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = $1
    `, [orderId]);
    
    if (itemsResult.rows.length === 0) {
      return res.status(400).json({ message: 'Order has no items' });
    }
    
    console.log('Order items for invoice:', itemsResult.rows.length, 'items');
    
    // Debug debt calculation
    console.log('Debt calculation debug:', {
      client_id: order.client_id,
      client_name: order.client_name,
      client_eur_debt: order.client_eur_debt,
      client_mkd_debt: order.client_mkd_debt,
      has_eur_debt: order.client_eur_debt > 0,
      has_mkd_debt: order.client_mkd_debt > 0
    });
    
    // Direct debt query for debugging
    if (order.client_id) {
      try {
        const directDebtResult = await query(`
          SELECT 
            ABS(SUM(CASE WHEN currency = 'EUR' THEN adjustment_amount ELSE 0 END)) as eur_debt,
            ABS(SUM(CASE WHEN currency = 'MKD' THEN adjustment_amount ELSE 0 END)) as mkd_debt
          FROM user_debt_adjustments 
          WHERE user_id = $1
        `, [order.client_id]);
        
        console.log('Direct debt query result:', directDebtResult.rows[0]);
        
        // Override with direct query results if they're different
        if (directDebtResult.rows[0]) {
          const directEur = parseFloat(directDebtResult.rows[0].eur_debt || 0);
          const directMkd = parseFloat(directDebtResult.rows[0].mkd_debt || 0);
          
          if (directEur !== order.client_eur_debt || directMkd !== order.client_mkd_debt) {
            console.log('Debt values differ, using direct query results');
            order.client_eur_debt = directEur;
            order.client_mkd_debt = directMkd;
          }
        }
      } catch (debtError) {
        console.error('Error in direct debt query:', debtError);
      }
    }

    // Get company settings
    const settingsResult = await query('SELECT * FROM settings ORDER BY id LIMIT 1');
    const settings = settingsResult.rows[0] || {
      company_name: 'POS CRM System',
      company_address: '123 Business Street',
      company_city_state: 'City, State 12345',
      company_phone: '(555) 123-4567',
      company_email: 'info@poscrm.com'
    };

    // Generate PDF
    const doc = new PDFDocument({ 
      margin: 50,
      size: 'A4'
    });

    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=invoice-${orderId}.pdf`);

    // Handle PDF generation errors
    doc.on('error', (err) => {
      console.error('PDF generation error:', err);
      if (!res.headersSent) {
        res.status(500).json({ message: 'PDF generation failed', error: err.message });
      }
    });

    // Pipe PDF to response
    doc.pipe(res);

    // Helper function to draw a line
    const drawLine = (y) => {
      doc.moveTo(50, y).lineTo(530, y).stroke();
    };

    // Helper function to draw a box
    const drawBox = (x, y, width, height) => {
      doc.rect(x, y, width, height).stroke();
    };

    // Set black color for all text
    const black = '#000000';

    // Header Section
    doc.fontSize(28).font('Helvetica-Bold').fillColor(black).text('INVOICE', { align: 'center' });
    
    // Company Logo/Name
    doc.fontSize(18).font('Helvetica-Bold').fillColor(black).text(settings.company_name, 50, 120);
    doc.fontSize(10).font('Helvetica').fillColor(black);
    if (settings.company_address) {
      doc.text(settings.company_address, 50, 140);
    }
    if (settings.company_city_state) {
      doc.text(settings.company_city_state, 50, 155);
    }
    if (settings.company_phone) {
      doc.text(`Phone: ${settings.company_phone}`, 50, 170);
    }
    if (settings.company_email) {
      doc.text(`Email: ${settings.company_email}`, 50, 185);
    }

    // Invoice Details (Right side)
    const invoiceDate = new Date(order.created_at).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    
    doc.fontSize(12).font('Helvetica-Bold').fillColor(black).text('INVOICE DETAILS', 350, 120);
    doc.fontSize(10).font('Helvetica').fillColor(black).text(`Invoice #: ${orderId}`, 350, 140);
    doc.text(`Date: ${invoiceDate}`, 350, 155);
    doc.text(`Status: ${order.status.toUpperCase()}`, 350, 170);
    
    // Draw line after header
    drawLine(200);
    doc.moveDown(1);

    // Bill To Section
    doc.fontSize(12).font('Helvetica-Bold').fillColor(black).text('BILL TO:', 50, 220);
    doc.fontSize(10).font('Helvetica').fillColor(black);
    
    if (order.client_name) {
      doc.text(order.client_name, 50, 240);
      doc.text(order.client_email, 50, 255);
    } else {
      doc.text(order.guest_name, 50, 240);
      doc.text(order.guest_email, 50, 255);
      if (order.guest_phone) {
        doc.text(order.guest_phone, 50, 270);
      }
    }

    // Items Table Header
    const tableY = 300;
    doc.fontSize(12).font('Helvetica-Bold').fillColor(black);
    
    // Draw table header box
    drawBox(50, tableY - 10, 480, 25);
    
    // Table headers
    doc.text('Product', 60, tableY);
    doc.text('Details', 220, tableY);
    doc.text('Qty', 320, tableY);
    doc.text('Price', 380, tableY);
    doc.text('Total', 480, tableY);
    
    // Draw line under header
    drawLine(tableY + 15);

    // Items - Separated by Currency
    let currentY = tableY + 25;
    doc.fontSize(10).font('Helvetica').fillColor(black);
    
    // Separate items by category
    const eurItems = itemsResult.rows.filter(item => item.category === 'smartphones');
    const mkdItems = itemsResult.rows.filter(item => item.category !== 'smartphones');
    
    // EUR Products (Smartphones) Section
    if (eurItems.length > 0) {
      // Section header
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#059669'); // Green color for EUR
      doc.text('EUR Products (Smartphones)', 60, currentY);
      currentY += 20;
      
      eurItems.forEach((item, index) => {
        const price = parseFloat(item.price);
        const itemTotal = item.quantity * price;
        
        // Alternate row colors (light green for even rows)
        if (index % 2 === 1) {
          doc.rect(50, currentY - 5, 480, 20).fill('#ecfdf5');
        }
        
        // Explicitly set text color to black for each row
        doc.fillColor(black);
        
        // Set font size to 8 for product details
        doc.fontSize(10).font('Helvetica');
        
        // For smartphones, show subcategory • model, otherwise just product name
        const displayName = item.subcategory && item.model 
          ? `${item.subcategory} • ${item.model}`
          : item.product_name;
        doc.text(displayName, 60, currentY);
        
        // Details column - show storage and color if available
        const details = [];
        if (item.storage_gb) details.push(item.storage_gb);
        if (item.color) details.push(item.color);
        const detailsText = details.length > 0 ? details.join(' • ') : '-';
        doc.text(detailsText, 220, currentY);
        
        doc.text(item.quantity.toString(), 320, currentY);
        doc.text(`${price.toFixed(0)} EUR`, 380, currentY);
        doc.text(`${itemTotal.toFixed(0)} EUR`, 480, currentY);
        
        currentY += 20;
      });
      
      currentY += 10; // Add space between sections
    }
    
    // MKD Products (Accessories) Section
    if (mkdItems.length > 0) {
      // Section header
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#1d4ed8'); // Blue color for MKD
      doc.text('MKD Products (Accessories)', 60, currentY);
      currentY += 20;
      
      mkdItems.forEach((item, index) => {
        const price = parseFloat(item.price);
        const itemTotal = item.quantity * price;
        
        // Alternate row colors (light blue for even rows)
        if (index % 2 === 1) {
          doc.rect(50, currentY - 5, 480, 20).fill('#eff6ff');
        }
        
        // Explicitly set text color to black for each row
        doc.fillColor(black);
        
        // Set font size to 8 for product details
        doc.fontSize(10).font('Helvetica');
        
        doc.text(item.product_name, 60, currentY);
        
        // Details column - show storage and color if available
        const details = [];
        if (item.storage_gb) details.push(item.storage_gb);
        if (item.color) details.push(item.color);
        const detailsText = details.length > 0 ? details.join(' • ') : '-';
        doc.text(detailsText, 220, currentY);
        
        doc.text(item.quantity.toString(), 320, currentY);
        doc.text(`${price.toFixed(0)} MKD`, 380, currentY);
        doc.text(`${itemTotal.toFixed(0)} MKD`, 480, currentY);
        
        currentY += 20;
      });
    }

    // Draw line after items
    drawLine(currentY + 5);

    // Calculate totals by currency
    const eurTotal = eurItems.reduce((sum, item) => sum + (parseFloat(item.price) * item.quantity), 0);
    const mkdTotal = mkdItems.reduce((sum, item) => sum + (parseFloat(item.price) * item.quantity), 0);
    
    // Calculate discount if not already set
    let actualDiscount = parseFloat(order.discount_amount || 0);
    if (actualDiscount === 0) {
      const originalTotal = eurTotal + mkdTotal;
      const finalTotal = parseFloat(order.total_amount || 0);
      if (originalTotal > finalTotal) {
        actualDiscount = originalTotal - finalTotal;
      }
    }
    
    console.log('Discount calculation:', {
      discount_amount: order.discount_amount,
      eurTotal,
      mkdTotal,
      originalTotal: eurTotal + mkdTotal,
      finalTotal: order.total_amount,
      calculatedDiscount: actualDiscount
    });
    
    // Total Section - Separated by Currency
    const totalY = currentY + 20;
    const totalBoxX = 350; // Moved to right side of page
    const totalBoxWidth = 180;
    
    let totalSectionY = totalY;
    
    // Discount Section (if applicable) - Display BEFORE totals
    if (actualDiscount > 0) {
      // Draw box around discount
      drawBox(totalBoxX, totalSectionY - 10, totalBoxWidth, 25);
      
      // Label on the left
      doc.fontSize(12)
        .font('Helvetica-Bold')
        .fillColor('#dc2626') // Red color for discount
        .text('Discount:', totalBoxX + 10, totalSectionY);
      
      // Amount right-aligned within the box
      doc.fontSize(12)
        .font('Helvetica-Bold')
        .fillColor('#dc2626')
        .text(`-${actualDiscount.toFixed(0)} ${order.discount_currency || 'EUR'}`, totalBoxX + 10, totalSectionY, { width: totalBoxWidth - 20, align: 'right' });
      
      totalSectionY += 35; // Space for next total
    }
    
    // EUR Total (if any)
    if (eurTotal > 0) {
      // Draw box around EUR total
      drawBox(totalBoxX, totalSectionY - 10, totalBoxWidth, 25);
      
      // Label on the left
      doc.fontSize(12)
        .font('Helvetica-Bold')
        .fillColor(black) // Black color for EUR total
        .text('Total EUR:', totalBoxX + 10, totalSectionY);

      // Amount right-aligned within the box - show discounted amount if discount exists
      const displayEurTotal = actualDiscount > 0 && eurTotal > 0 ? eurTotal - actualDiscount : eurTotal;
      doc.fontSize(12)
        .font('Helvetica-Bold')
        .fillColor(black)
        .text(`${displayEurTotal.toFixed(0)} EUR`, totalBoxX + 10, totalSectionY, { width: totalBoxWidth - 20, align: 'right' });
      
      totalSectionY += 35; // Space for next total
    }
    
    // MKD Total (if any)
    if (mkdTotal > 0) {
      // Draw box around MKD total
      drawBox(totalBoxX, totalSectionY - 10, totalBoxWidth, 25);
      
      // Label on the left
      doc.fontSize(12)
        .font('Helvetica-Bold')
        .fillColor(black) // Black color for MKD total
        .text('Total MKD:', totalBoxX + 10, totalSectionY);

      // Amount right-aligned within the box - show discounted amount if discount exists
      const displayMkdTotal = actualDiscount > 0 && mkdTotal > 0 ? mkdTotal - actualDiscount : mkdTotal;
      doc.fontSize(12)
        .font('Helvetica-Bold')
        .fillColor(black)
        .text(`${displayMkdTotal.toFixed(0)} MKD`, totalBoxX + 10, totalSectionY, { width: totalBoxWidth - 20, align: 'right' });
      
      totalSectionY += 35; // Space for next total
    }

    // Client Debt Information (displayed after totals)
    if (order.client_name && (order.client_eur_debt > 0 || order.client_mkd_debt > 0)) {
      doc.moveDown(1);

      const debtY = totalSectionY + 10;

      // Client debt title aligned to the right
      const debtTitleX = 360; // Starting position for debt title
      const debtTitleWidth = 160; // Width available for debt title
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#dc2626').text('CLIENT DEBT:', debtTitleX, debtY, { width: debtTitleWidth, align: 'right' });

      doc.fontSize(9).font('Helvetica').fillColor('#dc2626');
      let currentDebtY = debtY + 15;

      // Right-align debt amounts within the available space
      const debtAmountX = 360; // Starting position for debt amounts
      const debtWidth = 160; // Width available for debt amounts

      if (order.client_eur_debt > 0) {
        doc.text(`EUR Debt: ${parseFloat(order.client_eur_debt).toFixed(0)} EUR`, debtAmountX, currentDebtY, { width: debtWidth, align: 'right' });
        currentDebtY += 12;
      }
      if (order.client_mkd_debt > 0) {
        doc.text(`MKD Debt: ${parseFloat(order.client_mkd_debt).toFixed(0)} MKD`, debtAmountX, currentDebtY, { width: debtWidth, align: 'right' });
      }

      totalSectionY = currentDebtY + 15; // Update position for footer
    }

    
    // Finalize PDF
    doc.end();
  } catch (error) {
    console.error('Generate invoice error:', error);
    console.error('Error details:', {
      orderId,
      order: orderResult?.rows?.[0],
      items: itemsResult?.rows,
      errorMessage: error.message,
      errorStack: error.stack
    });
    
    // If response headers were already sent, we can't send JSON
    if (!res.headersSent) {
      res.status(500).json({ message: 'Failed to generate invoice', error: error.message });
    } else {
      // If headers were sent, try to end the response
      res.end();
    }
  }
});

// Update order (admin only) - can update status and items
router.put('/:id', authenticateToken, requireAdmin, [
  body('status').optional().isIn(['pending', 'completed']).withMessage('Status must be pending or completed'),
  body('items').optional().isArray({ min: 1 }).withMessage('Items must be an array with at least one item'),
  body('items.*.productId').isInt({ min: 1 }).withMessage('Product ID must be a positive integer'),
  body('items.*.quantity').isInt({ min: 1 }).withMessage('Quantity must be a positive integer'),
  body('items.*.price').isFloat({ min: 0 }).withMessage('Price must be a positive number')
], async (req, res) => {
  console.log('Update order request:', { orderId: req.params.id, body: req.body });
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log('Validation errors:', errors.array());
      return res.status(400).json({ 
        message: 'Validation error', 
        errors: errors.array() 
      });
    }

    const orderId = parseInt(req.params.id);
    const { status, items, originalItems, preserveDiscount, originalDiscount } = req.body;

    // Check if order exists
    const orderResult = await query('SELECT id FROM orders WHERE id = $1', [orderId]);
    if (orderResult.rows.length === 0) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Start a transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Update order status if provided
      if (status) {
        await client.query('UPDATE orders SET status = $1 WHERE id = $2', [status, orderId]);
      }

      // Update order items if provided
      if (items && Array.isArray(items)) {
        console.log('Updating order items:', { orderId, itemsCount: items.length });
        console.log('Items to insert:', JSON.stringify(items, null, 2));

        // Check if items actually changed by comparing with original items
        const itemsChanged = checkItemsChanged(originalItems || [], items);
        console.log('Items changed:', itemsChanged);

        if (!itemsChanged) {
          console.log('No item changes detected, skipping item updates and debt adjustments');
          // If only status changed, still update it
          if (status) {
            await client.query('UPDATE orders SET status = $1 WHERE id = $2', [status, orderId]);
          }
          await client.query('COMMIT');
          return res.json({
            message: 'Order updated successfully',
            orderId,
            status: status || 'unchanged',
            itemsUpdated: false
          });
        }
        
        // Get current order items before deletion to restore stock
        const currentItemsResult = await client.query(`
          SELECT oi.product_id, oi.quantity, oi.price, p.category
          FROM order_items oi
          JOIN products p ON oi.product_id = p.id
          WHERE oi.order_id = $1
        `, [orderId]);
        const currentItems = currentItemsResult.rows;
        console.log('Current items to restore stock:', currentItems);
        
        // Also get current stock levels for debugging
        for (const item of currentItems) {
          const stockResult = await client.query(
            'SELECT stock_quantity FROM products WHERE id = $1',
            [item.product_id]
          );
          const currentStock = stockResult.rows[0]?.stock_quantity || 0;
          console.log(`Product ${item.product_id} current stock: ${currentStock}, will restore: ${item.quantity}`);
        }
        
        // Restore stock for all current items
        for (const item of currentItems) {
          await client.query(
            'UPDATE products SET stock_quantity = stock_quantity + $1 WHERE id = $2',
            [item.quantity, item.product_id]
          );
          console.log(`Restored ${item.quantity} units to product ${item.product_id}`);
        }
        
        // Verify stock restoration worked
        for (const item of currentItems) {
          const stockResult = await client.query(
            'SELECT stock_quantity FROM products WHERE id = $1',
            [item.product_id]
          );
          const newStock = stockResult.rows[0]?.stock_quantity || 0;
          console.log(`Product ${item.product_id} stock after restoration: ${newStock}`);
        }
        
        // Get the order's client ID for debt adjustment
        const orderClientResult = await client.query(
          'SELECT client_id FROM orders WHERE id = $1',
          [orderId]
        );
        const clientId = orderClientResult.rows[0]?.client_id;
        
        // Delete existing order items
        const deleteResult = await client.query('DELETE FROM order_items WHERE order_id = $1', [orderId]);
        console.log('Deleted existing items:', deleteResult.rowCount);

        // Insert new order items and reduce stock
        for (const item of items) {
          console.log('Inserting item:', item);
          console.log('Item fields:', { 
            orderId, 
            productId: item.productId, 
            quantity: item.quantity, 
            price: item.price 
          });
          
          // Check if we have enough stock
          const stockCheckResult = await client.query(
            'SELECT stock_quantity FROM products WHERE id = $1',
            [item.productId]
          );
          
          if (stockCheckResult.rows.length === 0) {
            throw new Error(`Product ${item.productId} not found`);
          }
          
          const currentStock = stockCheckResult.rows[0].stock_quantity;
          if (currentStock < item.quantity) {
            throw new Error(`Insufficient stock for product ${item.productId}. Available: ${currentStock}, Requested: ${item.quantity}`);
          }
          
          // Reduce stock for the new item
          await client.query(
            'UPDATE products SET stock_quantity = stock_quantity - $1 WHERE id = $2',
            [item.quantity, item.productId]
          );
          console.log(`Reduced ${item.quantity} units from product ${item.productId}`);
          
          const insertResult = await client.query(
            'INSERT INTO order_items (order_id, product_id, quantity, price) VALUES ($1, $2, $3, $4)',
            [orderId, item.productId, item.quantity, item.price]
          );
          console.log('Inserted item result:', insertResult.rowCount);
        }
        
        // Calculate net debt change (original items vs new items)
        const { eurNetChange, mkdNetChange, noteDetails } = await calculateNetDebtChange(
          client,
          originalItems || [],
          items,
          orderId,
          clientId
        );

        console.log('Net debt changes:', { eurNetChange, mkdNetChange, noteDetails });

        // Create single debt adjustment log for net changes
        // Use negative amounts for debt increases (consistent with order creation)
        if (eurNetChange !== 0 && clientId) {
          try {
            const adjustmentAmount = -eurNetChange; // Negative for debt increases, positive for debt decreases
            await client.query(
              'INSERT INTO user_debt_adjustments (user_id, adjustment_amount, adjustment_type, currency, notes, created_by) VALUES ($1, $2, $3, $4, $5, $6)',
              [clientId, adjustmentAmount, 'manual_reduction', 'EUR', noteDetails.eurNote, req.user.id]
            );
            console.log(`Added EUR debt adjustment: ${adjustmentAmount} (net change: ${eurNetChange})`);
          } catch (debtError) {
            console.error('Error adding EUR debt adjustment:', debtError);
          }
        }

        if (mkdNetChange !== 0 && clientId) {
          try {
            const adjustmentAmount = -mkdNetChange; // Negative for debt increases, positive for debt decreases
            await client.query(
              'INSERT INTO user_debt_adjustments (user_id, adjustment_amount, adjustment_type, currency, notes, created_by) VALUES ($1, $2, $3, $4, $5, $6)',
              [clientId, adjustmentAmount, 'manual_reduction', 'MKD', noteDetails.mkdNote, req.user.id]
            );
            console.log(`Added MKD debt adjustment: ${adjustmentAmount} (net change: ${mkdNetChange})`);
          } catch (debtError) {
            console.error('Error adding MKD debt adjustment:', debtError);
          }
        }

        // Recalculate order total
        const totalsResult = await client.query(`
          SELECT SUM(oi.quantity * oi.price) as total_amount
          FROM order_items oi
          WHERE oi.order_id = $1
        `, [orderId]);

        const totals = totalsResult.rows[0];
        console.log('Calculated total:', totals);
        
        // Preserve discount if requested
        let finalTotal = totals.total_amount || 0;
        if (preserveDiscount && originalDiscount > 0) {
          finalTotal = Math.max(0, finalTotal - originalDiscount);
          console.log(`Preserved discount: ${originalDiscount}, final total: ${finalTotal}`);
        }
        
        await client.query(
          'UPDATE orders SET total_amount = $1 WHERE id = $2',
          [finalTotal, orderId]
        );
        console.log('Updated order total in database');
      }

      await client.query('COMMIT');

    res.json({ 
        message: 'Order updated successfully',
      orderId,
        status: status || 'unchanged',
        itemsUpdated: items ? true : false
    });
  } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Update order error:', error);
    res.status(500).json({ message: 'Failed to update order' });
  }
});

// Delete order (admin only)
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const orderId = parseInt(req.params.id);

    // Check if order exists
    const orderResult = await client.query('SELECT id, status FROM orders WHERE id = $1', [orderId]);
    if (orderResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Order not found' });
    }

    const orderStatus = orderResult.rows[0].status;

    // Get all order items before deleting them
    const orderItemsResult = await client.query(
      'SELECT product_id, quantity FROM order_items WHERE order_id = $1',
      [orderId]
    );

    // Restore stock quantities for each product
    for (const item of orderItemsResult.rows) {
      await client.query(
        'UPDATE products SET stock_quantity = stock_quantity + $1 WHERE id = $2',
        [item.quantity, item.product_id]
      );
    }

    console.log(`Restored stock for ${orderItemsResult.rows.length} products from order ${orderId}`);

    // Delete order items first (due to foreign key constraint)
    await client.query('DELETE FROM order_items WHERE order_id = $1', [orderId]);

    // Delete the order
    await client.query('DELETE FROM orders WHERE id = $1', [orderId]);

    // Log the restoration action
    console.log(`Order ${orderId} deleted and stock restored for ${orderItemsResult.rows.length} items`);

    await client.query('COMMIT');

    res.json({
      message: `Order deleted successfully and ${orderItemsResult.rows.length} items restored to inventory`,
      orderId,
      itemsRestored: orderItemsResult.rows.length
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Delete order error:', error);
    res.status(500).json({ message: 'Failed to delete order' });
  } finally {
    client.release();
  }
});

// Update order status only (admin only) - for backward compatibility
router.put('/:id/status', authenticateToken, requireAdmin, [
  body('status').isIn(['pending', 'completed']).withMessage('Status must be pending or completed')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        message: 'Validation error', 
        errors: errors.array() 
      });
    }

    const orderId = parseInt(req.params.id);
    const { status } = req.body;

    // Check if order exists
    const orderResult = await query('SELECT id FROM orders WHERE id = $1', [orderId]);
    if (orderResult.rows.length === 0) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Update order status
    await query('UPDATE orders SET status = $1 WHERE id = $2', [status, orderId]);

    res.json({ 
      message: 'Order status updated successfully',
      orderId,
      status 
    });
  } catch (error) {
    console.error('Update order status error:', error);
    res.status(500).json({ message: 'Failed to update order status' });
  }
});

module.exports = router; 