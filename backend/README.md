# MSFG Dashboard Backend API

Node.js/Express backend API for the MSFG Dashboard application.

## Architecture

- **Framework**: Express.js
- **Database**: MySQL (RDS Aurora)
- **File Storage**: AWS S3
- **Deployment**: EC2 Instance

## API Endpoints

### Health Check
- `GET /health` - Server health status

### Investors
- `GET /api/investors` - Get all investors
- `GET /api/investors/:key` - Get investor by key
- `PUT /api/investors/:id` - Update investor

### Announcements
- `GET /api/announcements` - Get all announcements
- `POST /api/announcements` - Create announcement
- `DELETE /api/announcements/:id` - Delete announcement

### Notifications
- `GET /api/notifications` - Get notifications (optional: ?user_id=X)
- `POST /api/notifications` - Create notification/reminder
- `DELETE /api/notifications/:id` - Delete notification

### Goals
- `GET /api/goals` - Get goals (optional: ?user_id=X&period_type=X&period_value=X)
- `PUT /api/goals` - Update/create goals (accepts array or single object)

### Files
- `POST /api/files/upload-url` - Get S3 presigned URL for file upload

## Setup

See `DEPLOY_TO_EC2.md` for complete deployment instructions.

## Environment Variables

See `.env.example` for required environment variables.

## Development

```bash
# Install dependencies
npm install

# Run in development mode (with auto-reload)
npm run dev

# Run in production mode
npm start

# Run database migrations
npm run migrate
```

## Project Structure

```
backend/
├── server.js              # Main server entry point
├── package.json           # Dependencies
├── .env                   # Environment variables (not in git)
├── .env.example           # Example environment file
├── db/
│   ├── connection.js      # Database connection pool
│   └── migrations.js      # Database migrations
└── routes/
    ├── investors.js       # Investor routes
    ├── announcements.js   # Announcement routes
    ├── notifications.js   # Notification routes
    ├── goals.js          # Goals routes
    └── files.js          # File upload routes
```

