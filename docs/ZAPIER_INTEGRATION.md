# Zapier Integration Guide

## Overview

This API supports Zapier webhooks for integrating external systems with your MSFG Dashboard. You can create, update, and manage Tasks, Pre-Approvals, and Pipeline items from external applications.

---

## Quick Start

### 1. Generate an API Key

On your EC2 server, run:

```bash
cd ~/msfg-backend
node scripts/generateApiKey.js "Zapier Production" 1
```

This will output:
- API Key (save this!)
- Secret Key (save this!)

**⚠️ Important:** These keys are shown only once. Save them securely!

### 2. Use the API Key in Zapier

In your Zapier webhook configuration:

**Option A: Header Authentication (Recommended)**
- Header Name: `X-API-Key`
- Header Value: `your-api-key-here`

**Option B: Query Parameter**
- Add `?api_key=your-api-key-here` to the URL

---

## API Endpoints

### Base URL

**Production:** `https://api.msfgco.com/api/webhooks`  
**Development:** `http://54.175.238.145:8080/api/webhooks`

---

## Tasks Webhooks

### Create Task

**POST** `/webhooks/tasks`

**Request Body:**
```json
{
  "title": "Call client - rate lock expiring",
  "description": "Client needs to lock rate by end of day",
  "priority": "high",
  "status": "todo",
  "due_date": "2025-12-20",
  "due_time": "17:00",
  "assigned_to": "Zachary B.",
  "user_id": 1
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": 123,
    "title": "Call client - rate lock expiring",
    "status": "todo",
    ...
  }
}
```

### Update Task

**PUT** `/webhooks/tasks/:id`

**Request Body:** (only include fields to update)
```json
{
  "status": "done",
  "priority": "medium"
}
```

---

## Pre-Approvals Webhooks

### Create Pre-Approval

**POST** `/webhooks/pre-approvals`

**Request Body:**
```json
{
  "client_name": "John Smith",
  "loan_amount": 450000,
  "pre_approval_date": "2025-12-18",
  "expiration_date": "2026-01-18",
  "status": "active",
  "assigned_lo_name": "Zachary B.",
  "property_address": "123 Main St",
  "loan_type": "Conventional",
  "notes": "Waiting on property selection"
}
```

**Required Fields:**
- `client_name`
- `loan_amount`
- `pre_approval_date` (format: YYYY-MM-DD)
- `expiration_date` (format: YYYY-MM-DD)

**Optional Fields:**
- `status` (default: "active")
- `assigned_lo_id`
- `assigned_lo_name`
- `property_address`
- `loan_type`
- `notes`

---

## Pipeline Webhooks

### Create Pipeline Item

**POST** `/webhooks/pipeline`

**Request Body:**
```json
{
  "client_name": "Jane Doe",
  "loan_amount": 320000,
  "loan_type": "FHA",
  "stage": "Underwriting",
  "target_close_date": "2025-12-28",
  "assigned_lo_name": "Sarah M.",
  "investor": "NewRez",
  "status": "On Track",
  "notes": "Waiting for appraisal"
}
```

**Required Fields:**
- `client_name`
- `loan_amount`
- `stage`

**Common Stage Values:**
- "Application"
- "Processing"
- "Underwriting"
- "Clear to Close"
- "Closed"

---

## Bulk Operations

### Create Multiple Tasks

**POST** `/webhooks/bulk/tasks`

**Request Body:**
```json
{
  "tasks": [
    {
      "title": "Task 1",
      "priority": "high",
      "due_date": "2025-12-20"
    },
    {
      "title": "Task 2",
      "priority": "medium",
      "due_date": "2025-12-21"
    }
  ]
}
```

---

## Zapier Setup Example

### 1. Create a New Zap

1. Choose your trigger (e.g., "New Form Submission", "New Email", etc.)
2. Choose action: "Webhooks by Zapier" → "POST"

### 2. Configure Webhook

**URL:**
```
https://api.msfgco.com/api/webhooks/tasks
```

**Method:** POST

**Headers:**
```
X-API-Key: your-api-key-here
Content-Type: application/json
```

**Data (JSON):**
```json
{
  "title": "{{form_field_title}}",
  "description": "{{form_field_description}}",
  "priority": "high",
  "due_date": "{{form_field_due_date}}",
  "assigned_to": "{{form_field_assigned_to}}"
}
```

### 3. Test

Click "Test" to send a test webhook. Check your dashboard to verify the task was created!

---

## Response Codes

- **200 OK** - Success
- **201 Created** - Resource created successfully
- **400 Bad Request** - Invalid request data
- **401 Unauthorized** - Invalid or missing API key
- **403 Forbidden** - API key not authorized for this endpoint
- **404 Not Found** - Resource not found
- **500 Internal Server Error** - Server error

---

## Error Responses

```json
{
  "error": "Error message here"
}
```

---

## Monitoring Webhook Calls

All webhook calls are logged in the `webhook_logs` table. You can query it:

```sql
SELECT * FROM webhook_logs 
ORDER BY created_at DESC 
LIMIT 50;
```

This shows:
- Endpoint called
- Request payload
- Response code
- Timestamp
- IP address

---

## Security Best Practices

1. **Rotate API keys regularly** - Generate new keys and deactivate old ones
2. **Use specific endpoints** - Restrict API keys to specific endpoints if needed
3. **Monitor logs** - Regularly check webhook_logs for suspicious activity
4. **Use HTTPS only** - Always use `https://api.msfgco.com` in production
5. **Store keys securely** - Never commit API keys to version control

---

## Managing API Keys

### List All API Keys

```sql
SELECT id, key_name, active, created_at, last_used_at 
FROM api_keys 
ORDER BY created_at DESC;
```

### Deactivate an API Key

```sql
UPDATE api_keys 
SET active = FALSE 
WHERE id = ?;
```

### Delete an API Key

```sql
DELETE FROM api_keys 
WHERE id = ?;
```

---

## Support

For issues or questions:
- Check webhook logs in database
- Review API response codes
- Verify API key is active
- Check endpoint URL is correct

