# MSFG Dashboard API Documentation

## Base URL
```
http://54.175.238.145:8080/api
```
(Update port based on your Spring Boot configuration)

## Authentication
All endpoints require authentication. Include JWT token in header:
```
Authorization: Bearer <token>
```

---

## Investors API

### Get All Investors
```
GET /investors
```
**Response:**
```json
[
  {
    "id": 1,
    "investorKey": "keystone",
    "name": "Keystone",
    "logoUrl": "https://...",
    "loginUrl": "https://...",
    "accountExecutive": {
      "name": "Ryan Hartwig",
      "mobile": "(303) 324-0098",
      "email": "rhartwig@KeystoneFunding.com",
      "address": "519 S. Red Haven Ln. Dover, DE 19901"
    },
    "team": [...],
    "lenderIds": {
      "fha": "0071100005",
      "va": "9017260000"
    },
    "mortgageeClause": {...},
    "links": [...],
    "notes": "User notes here"
  }
]
```

### Get Investor by Key
```
GET /investors/{investorKey}
```

### Update Investor Notes
```
PUT /investors/{investorKey}/notes
Content-Type: application/json

{
  "notes": "Updated notes here"
}
```

### Update Investor Section
```
PUT /investors/{investorKey}/section/{sectionName}
Content-Type: application/json

{
  "data": { ... }
}
```

---

## Announcements API

### Get All Announcements
```
GET /announcements?limit=50&offset=0
```

### Create Announcement
```
POST /announcements
Content-Type: multipart/form-data

{
  "title": "Announcement Title",
  "content": "Content here",
  "link": "https://example.com" (optional),
  "icon": "fa-star" (optional),
  "file": <file> (optional)
}
```

### Delete Announcement
```
DELETE /announcements/{id}
```

### Get Announcement File
```
GET /announcements/{id}/file
```
Returns S3 signed URL for file download

---

## Notifications/Reminders API

### Get User Reminders
```
GET /notifications
```

### Create Reminder
```
POST /notifications
Content-Type: application/json

{
  "reminderDate": "2024-12-20",
  "reminderTime": "14:30:00",
  "note": "Follow up with client"
}
```

### Delete Reminder
```
DELETE /notifications/{id}
```

### Mark Reminder as Sent
```
PUT /notifications/{id}/sent
```

---

## Goals API

### Get Goals
```
GET /goals?periodType=monthly&periodValue=2024-12
```

### Update Goal
```
PUT /goals
Content-Type: application/json

{
  "periodType": "monthly",
  "periodValue": "2024-12",
  "goalType": "loans-closed",
  "currentValue": 18,
  "targetValue": 25
}
```

---

## User Preferences API

### Get User Preferences
```
GET /user/preferences
```

### Update Preferences
```
PUT /user/preferences
Content-Type: application/json

{
  "theme": "dark",
  "defaultGoalPeriod": "monthly"
}
```

---

## S3 File Upload

### Get Upload URL
```
POST /files/upload-url
Content-Type: application/json

{
  "fileName": "document.pdf",
  "fileType": "application/pdf",
  "fileSize": 1024000
}
```

**Response:**
```json
{
  "uploadUrl": "https://s3.amazonaws.com/...",
  "fileKey": "announcements/123/document.pdf",
  "expiresIn": 3600
}
```

### Upload File to S3
Use the uploadUrl from above to PUT the file directly to S3.

---

## Error Responses

All errors follow this format:
```json
{
  "error": "Error message",
  "code": "ERROR_CODE",
  "timestamp": "2024-12-18T12:00:00Z"
}
```

**Status Codes:**
- 200: Success
- 201: Created
- 400: Bad Request
- 401: Unauthorized
- 404: Not Found
- 500: Server Error

