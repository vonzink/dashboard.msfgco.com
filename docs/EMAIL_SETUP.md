# Email notifications (Amazon SES)

The **"Email the team about this post"** checkbox on the New Announcement modal
sends a branded email to every dashboard user when an announcement is created.
Delivery uses **Amazon SES** through the backend service
[`backend/services/email.js`](../backend/services/email.js), called from
`POST /api/announcements` when `notify_email` is true.

Like the S3 and Cognito clients, the SES client authenticates with the **EC2
instance IAM role** — no credentials are stored in the app. Two one-time AWS
steps are required before the feature can send mail.

## 1. Verify the sender in SES

The From address is `info@msfginfo.com`. SES will only send from a verified
identity, so verify either the address or (preferred) the whole domain in the
**same region** the backend uses (`SES_REGION`, default `us-east-1`):

- **Domain identity (recommended):** SES → *Verified identities* → *Create
  identity* → *Domain* → `msfginfo.com`. Add the DKIM CNAME records SES gives
  you to the `msfginfo.com` DNS (Porkbun). Domain verification lets any
  `@msfginfo.com` address send and improves deliverability.
- **Single email identity (quick):** *Create identity* → *Email address* →
  `info@msfginfo.com` → click the confirmation link SES emails there.

## 2. Leave the SES sandbox

New SES accounts are in the **sandbox**, which can only send *to* verified
addresses — team members wouldn't receive anything. Request production access:
SES → *Account dashboard* → *Request production access*. Until then, you can
test by also verifying a couple of recipient addresses.

## 3. Grant the EC2 role permission to send

Add this to the IAM role attached to the backend EC2 instance (the same role
that already allows S3/Cognito):

```json
{
  "Effect": "Allow",
  "Action": ["ses:SendEmail"],
  "Resource": "*"
}
```

You can scope `Resource` to the verified identity ARN if you prefer.

## Configuration (optional environment variables)

All have working defaults; set them in the backend environment only to override.

| Variable | Default | Purpose |
| --- | --- | --- |
| `SES_REGION` | `AWS_REGION` or `us-east-1` | SES region (must match where the sender is verified) |
| `ANNOUNCEMENT_FROM_EMAIL` | `info@msfginfo.com` | From address (must be SES-verified) |
| `ANNOUNCEMENT_FROM_NAME` | `MSFG News & Announcements` | From display name |
| `ANNOUNCEMENT_REPLY_TO` | the From address | Reply-To address |
| `DASHBOARD_URL` | `https://dashboard.msfgco.com` | Link target in the email |

## Behavior notes

- **Opt-in per announcement.** The checkbox is off by default; email is sent
  only when it is checked.
- **Recipients** are every row in the `users` table with an email — i.e. all
  dashboard users. They are **BCC'd** (addresses are never exposed to each
  other); the visible To is `info@msfginfo.com`. Sends are batched at 45
  recipients per message to stay under the SES 50-recipient limit.
- **Failures never block posting.** The announcement is saved first; if SES is
  misconfigured or errors, the API still returns success and the publish dialog
  notes that the email could not be sent. Details are in the backend logs
  (`announcement email …`).
