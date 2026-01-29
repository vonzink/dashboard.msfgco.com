# Backend Update: Support Key-Based Investor Updates

## File to Update: `~/msfg-backend/routes/investors.js`

## Change Needed:

Update the PUT route (starting around line 93) to accept both ID and key.

### Current Code (lines 93-139):
```javascript
// PUT /api/investors/:id - Update investor
router.put('/:id', async (req, res, next) => {
  // ... uses WHERE id = ?
```

### Updated Code:
```javascript
// PUT /api/investors/:idOrKey - Update investor (by ID or key)
router.put('/:idOrKey', async (req, res, next) => {
  try {
    const { notes, account_executive_name, account_executive_mobile, account_executive_email, account_executive_address } = req.body;
    
    const updates = [];
    const values = [];
    
    if (notes !== undefined) {
      updates.push('notes = ?');
      values.push(notes);
    }
    if (account_executive_name !== undefined) {
      updates.push('account_executive_name = ?');
      values.push(account_executive_name);
    }
    if (account_executive_mobile !== undefined) {
      updates.push('account_executive_mobile = ?');
      values.push(account_executive_mobile);
    }
    if (account_executive_email !== undefined) {
      updates.push('account_executive_email = ?');
      values.push(account_executive_email);
    }
    if (account_executive_address !== undefined) {
      updates.push('account_executive_address = ?');
      values.push(account_executive_address);
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }
    
    // Check if idOrKey is numeric (ID) or string (key)
    const isNumeric = /^\d+$/.test(req.params.idOrKey);
    const whereClause = isNumeric 
      ? 'WHERE id = ?' 
      : 'WHERE investor_key = ?';
    
    values.push(req.params.idOrKey);
    
    await db.query(
      `UPDATE investors SET ${updates.join(', ')}, updated_at = NOW() ${whereClause}`,
      values
    );
    
    // Get the updated investor
    const [investors] = await db.query(
      `SELECT * FROM investors ${whereClause}`,
      [req.params.idOrKey]
    );
    
    if (investors.length === 0) {
      return res.status(404).json({ error: 'Investor not found' });
    }
    
    res.json(investors[0]);
  } catch (error) {
    next(error);
  }
});
```

## Steps:

1. On EC2, edit the file: `nano ~/msfg-backend/routes/investors.js`
2. Find the PUT route (around line 93)
3. Replace it with the updated code above
4. Save and exit (Ctrl+X, Y, Enter)
5. Restart PM2: `pm2 restart msfg-backend`

