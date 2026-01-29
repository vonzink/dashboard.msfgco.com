# Migration Guide: localStorage to Server API

## Overview
This guide helps you migrate from browser localStorage to server-side database storage.

## Migration Steps

### 1. Update API Configuration

The `config.js` has been updated with the EC2 server URL:
```javascript
api: {
    baseUrl: 'http://54.175.238.145:8080/api'
}
```

### 2. Replace localStorage Calls

#### Before (localStorage):
```javascript
Utils.setStorage('announcements', announcements);
const announcements = Utils.getStorage('announcements', []);
```

#### After (Server API):
```javascript
await ServerAPI.createAnnouncement(announcementData);
const announcements = await ServerAPI.getAnnouncements();
```

### 3. Update Files

#### File: `js/modals.js`

**Find and Replace:**
- `Utils.getStorage('announcements')` → `await ServerAPI.getAnnouncements()`
- `Utils.setStorage('announcements', ...)` → `await ServerAPI.createAnnouncement(...)`
- `Utils.getStorage('notifications')` → `await ServerAPI.getNotifications()`
- `Utils.setStorage('notifications', ...)` → `await ServerAPI.createNotification(...)`

#### File: `js/investors.js`

**Find and Replace:**
- `Utils.getStorage('investor_notes_...')` → `await ServerAPI.getInvestor(...)`
- `Utils.setStorage('investor_notes_...', ...)` → `await ServerAPI.updateInvestorNotes(...)`

#### File: `js/goals.js`

**Find and Replace:**
- `Utils.getStorage('goal_...')` → `await ServerAPI.getGoals(...)`
- `Utils.setStorage('goal_...', ...)` → `await ServerAPI.updateGoal(...)`

### 4. Add ServerAPI Script

Add to `index.html` before other scripts:
```html
<script src="js/api-server.js"></script>
```

### 5. Handle Async Operations

Since API calls are async, update functions:

```javascript
// Before
saveAnnouncement(announcement) {
    const announcements = Utils.getStorage('announcements', []);
    announcements.push(announcement);
    Utils.setStorage('announcements', announcements);
}

// After
async saveAnnouncement(announcement) {
    try {
        await ServerAPI.createAnnouncement(announcement);
    } catch (error) {
        console.error('Failed to save announcement:', error);
        alert('Failed to save announcement. Please try again.');
    }
}
```

### 6. Update Initialization

Load data from server on page load:

```javascript
async init() {
    try {
        // Load announcements from server
        const announcements = await ServerAPI.getAnnouncements();
        this.renderAnnouncements(announcements);
        
        // Load investors from server
        const investors = await ServerAPI.getInvestors();
        Investors.data = investors;
        
        // Load goals from server
        const goals = await ServerAPI.getGoals('monthly', getCurrentPeriod());
        GoalsManager.goals = goals;
    } catch (error) {
        console.error('Failed to load initial data:', error);
    }
}
```

### 7. File Uploads

For file uploads, use S3:

```javascript
async handleFileUpload(file) {
    try {
        // Get upload URL from server
        const { uploadUrl, fileKey } = await ServerAPI.getUploadUrl(
            file.name,
            file.type,
            file.size
        );
        
        // Upload directly to S3
        await ServerAPI.uploadToS3(uploadUrl, file);
        
        // Save file key with announcement
        return fileKey;
    } catch (error) {
        console.error('File upload failed:', error);
        throw error;
    }
}
```

### 8. Error Handling

Add proper error handling for network failures:

```javascript
async loadData() {
    try {
        return await ServerAPI.getInvestors();
    } catch (error) {
        if (error.name === 'AbortError') {
            console.error('Request timeout');
            return null;
        } else if (error.message.includes('401')) {
            // Redirect to login
            window.location.href = '/login';
            return null;
        } else {
            console.error('API error:', error);
            // Show user-friendly message
            this.showNotification('Failed to load data. Please try again.', 'error');
            return null;
        }
    }
}
```

### 9. Loading States

Add loading indicators:

```javascript
async loadAnnouncements() {
    this.showLoading(true);
    try {
        const announcements = await ServerAPI.getAnnouncements();
        this.renderAnnouncements(announcements);
    } catch (error) {
        this.showError('Failed to load announcements');
    } finally {
        this.showLoading(false);
    }
}
```

### 10. Testing Checklist

- [ ] All API endpoints are accessible
- [ ] Authentication works
- [ ] CRUD operations work (Create, Read, Update, Delete)
- [ ] File uploads to S3 work
- [ ] Error handling works
- [ ] Loading states display correctly
- [ ] Data persists after page refresh
- [ ] Multiple users can use the system
- [ ] CORS is configured correctly

## Rollback Plan

If issues arise, you can temporarily revert to localStorage by:

1. Commenting out ServerAPI calls
2. Uncommenting Utils.getStorage/setStorage calls
3. Keeping the API code commented for future migration

## Next Steps After Migration

1. **Add Authentication**: Implement JWT-based authentication
2. **Add Authorization**: Control who can edit/delete
3. **Add Logging**: Log all API requests for debugging
4. **Add Monitoring**: Set up CloudWatch alerts
5. **Add Caching**: Implement client-side caching for better performance
6. **Add Pagination**: For large datasets
7. **Add Real-time Updates**: WebSocket for live announcements

