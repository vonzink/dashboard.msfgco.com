# Testing Checklist - MSFG Dashboard API Integration

## 1. Frontend Loading Test

1. Open your browser and go to: `https://dashboard.msfgco.com` (or your S3 URL)
2. Open browser DevTools (F12) → Console tab
3. Check for errors:
   - Should see: `✅ MSFG Dashboard ready!`
   - Should NOT see red errors about ServerAPI or fetch failures
4. Check Network tab → Look for requests to `http://54.175.238.145:8080/api/`

---

## 2. Test API Connection

### Test Health Endpoint
In browser console, run:
```javascript
fetch('http://54.175.238.145:8080/health')
  .then(r => r.json())
  .then(console.log)
```

**Expected:** `{status: "ok", timestamp: "..."}`

### Test API from Frontend
In browser console, run:
```javascript
ServerAPI.getAnnouncements().then(console.log).catch(console.error)
```

**Expected:** Array of announcements (might be empty `[]` if none exist)

---

## 3. Test Investor Notes

1. Click on **Investors** dropdown in navigation
2. Click on any investor (e.g., "Keystone")
3. Investor modal should open
4. Click the **settings cog** (⚙️) in top right
5. Find the **Notes** section at bottom
6. Click to edit and type a test note
7. Click outside or press Enter to save
8. Check browser console for: `Notes saved successfully`
9. Close modal and reopen the same investor
10. **Expected:** Your note should still be there

---

## 4. Test Announcements

### Create Announcement
1. Click **Add Announcement** button
2. Fill in:
   - Title: "Test Announcement"
   - Content: "This is a test"
   - Optionally: add a link or icon
3. Click **Save**
4. **Expected:** Announcement appears at top of news feed

### Delete Announcement
1. Find the announcement you just created
2. Click the **trash can icon** (🗑️) on it
3. Confirm deletion
4. **Expected:** Announcement disappears

### Test File Upload (Optional)
1. Create new announcement
2. Click **Upload File** and select a file
3. Fill in title/content and save
4. **Expected:** File name appears in announcement
5. Check S3 bucket `msfg-dashboard-files` to verify file was uploaded

---

## 5. Test Goals

1. Go to **Performance & Goals** section
2. Change the period dropdown (Weekly, Monthly, Quarterly, Yearly)
3. Click **Edit** button (pencil icon) on any goal
4. Adjust the slider to change target value
5. Click outside to save
6. Change period away and back
7. **Expected:** Your goal values are preserved

---

## 6. Test Notifications/Reminders

1. Click **Notifications** in navigation
2. Fill in:
   - Date: Pick a future date
   - Time: Pick a time
   - Note: "Test reminder"
3. Click **Set Reminder**
4. **Expected:** Success message appears
5. Check browser console for any errors

---

## 7. Check Backend Logs

On EC2, check if API is receiving requests:
```bash
pm2 logs msfg-backend --lines 50
```

Look for:
- Successful requests: No errors
- Database queries executing
- File upload requests (if testing file uploads)

---

## 8. Check Database

Connect to database and verify data is being saved:

```bash
mysql -h msfg-mortgage-db.cghqooasg1vk.us-east-1.rds.amazonaws.com -u admin -p msfg_mortgage_db
```

Then run:
```sql
-- Check announcements
SELECT * FROM announcements ORDER BY created_at DESC LIMIT 5;

-- Check goals
SELECT * FROM goals ORDER BY updated_at DESC LIMIT 5;

-- Check investor notes
SELECT id, investor_key, name, LEFT(notes, 50) as notes_preview FROM investors WHERE notes IS NOT NULL AND notes != '';

-- Check notifications
SELECT * FROM notifications ORDER BY reminder_date, reminder_time LIMIT 5;
```

---

## Common Issues & Solutions

### Issue: CORS Errors in Console
**Symptom:** `Access to fetch at '...' from origin '...' has been blocked by CORS policy`

**Solution:** Check backend has CORS enabled (it should be in `server.js`)

### Issue: 404 Errors for API Endpoints
**Symptom:** `Failed to fetch` or `404 Not Found`

**Solution:** 
- Verify backend is running: `pm2 status`
- Check backend logs: `pm2 logs msfg-backend`
- Test API directly: `curl http://54.175.238.145:8080/health`

### Issue: Database Connection Errors
**Symptom:** Backend logs show database connection errors

**Solution:**
- Check `.env` file has correct database credentials
- Test database connection: `mysql -h msfg-mortgage-db... -u admin -p`
- Check RDS security group allows connections from EC2

### Issue: Investor Notes Not Saving
**Symptom:** Notes disappear after closing modal

**Solution:**
- Check browser console for errors
- Verify investor exists in database: `SELECT * FROM investors WHERE investor_key = 'keystone';`
- Check backend logs for errors when saving

### Issue: Goals Not Saving
**Symptom:** Goals reset when changing period

**Solution:**
- Check browser console for API errors
- Verify goals table structure: `DESCRIBE goals;`
- Check backend logs when saving goals

---

## Quick Browser Console Tests

Run these in your browser console on the dashboard page:

```javascript
// Test 1: API connection
ServerAPI.getAnnouncements().then(d => console.log('✅ Announcements:', d)).catch(e => console.error('❌ Error:', e))

// Test 2: Create test announcement
ServerAPI.createAnnouncement({
  title: 'Console Test',
  content: 'Testing from browser console',
  author_id: 1
}).then(d => console.log('✅ Created:', d)).catch(e => console.error('❌ Error:', e))

// Test 3: Get investors
ServerAPI.getInvestors().then(d => console.log('✅ Investors:', d.length, 'found')).catch(e => console.error('❌ Error:', e))

// Test 4: Test goal update
ServerAPI.updateGoals({
  user_id: null,
  period_type: 'monthly',
  period_value: '2025-12',
  goal_type: 'loans-closed',
  current_value: 10,
  target_value: 25
}).then(d => console.log('✅ Goal updated:', d)).catch(e => console.error('❌ Error:', e))
```

---

## Success Criteria

✅ All features work without localStorage
✅ Data persists after page refresh
✅ No console errors related to API calls
✅ Backend logs show successful requests
✅ Database contains the data you create
✅ File uploads work (if tested)
✅ All modals open and close correctly

---

**If everything passes these tests, your integration is complete! 🎉**

