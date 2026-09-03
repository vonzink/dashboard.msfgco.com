# Plaud → S3 Audio Archive

Copies every new recording from your Plaud recorder into our own S3 bucket as
an MP3, on a schedule. Plaud stays the capture device; S3 becomes the source of
truth for the audio. What happens after that (transcription, etc.) is a
separate step that reads from the bucket.

```
Plaud recorder ──sync──▶ Plaud cloud ──(cron every 15 min)──▶ s3://msfg-plaud-recordings/recordings/YYYY/MM/*.mp3
                                                │
                                                └──▶ plaud_recordings table (what was copied, when, how big)
```

## What's in the repo

| Path | Purpose |
|------|---------|
| `backend/scripts/plaud-sync.js` | Cron entry point. Has `--check`, `--dry-run`, `--limit N`, `--pages N`. |
| `backend/services/plaud/client.js` | Talks to Plaud's API. Uses the token file `plaud login` creates and refreshes it when needed. |
| `backend/services/plaud/tokenStore.js` | Reads/writes `~/.plaud/tokens.json`. |
| `backend/services/plaud/sync.js` | The actual job: list → dedupe → stream to S3 → record. |
| `backend/services/s3.js` | Gained `uploadStream()` and the `plaud` bucket entry. |
| `backend/db/migrations/091_plaud_recordings.sql` | The tracking table. Runs automatically when the backend starts. |

## How it works

1. Ask Plaud for the newest recordings (one page of 50 by default).
2. Skip anything already marked `synced` in `plaud_recordings`, or marked `failed` after 5 real failures.
3. Ask Plaud for the recording's 24-hour signed audio link and stream the MP3 straight into S3. No temp files, nothing held in memory.
4. Record bucket, key, byte count and time on the row.

A recording whose audio hasn't reached Plaud's cloud yet (recorder not synced
to the phone app) has no audio link. Those stay `pending` and are retried on
every run without counting as a failure.

Files land as `recordings/2026/09/20260902-205238_<plaud id>.mp3`, so a folder
listing sorts by date and the Plaud id keeps names unique.

## One-time setup

Order matters: bucket and permission first, then deploy the code, then log in
on the server, then the cron line.

### Step 1 — Create the bucket (local, your Mac)

Path: anywhere. Nothing to replace.

```bash
aws s3api create-bucket --bucket msfg-plaud-recordings --region us-west-2 --create-bucket-configuration LocationConstraint=us-west-2
aws s3api put-public-access-block --bucket msfg-plaud-recordings --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-encryption --bucket msfg-plaud-recordings --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
```

If you'd rather use the console: S3 → Create bucket → name `msfg-plaud-recordings`, region US West (Oregon), leave "Block all public access" on.

### Step 2 — Let the EC2 role write to it (local)

The backend on EC2 gets its AWS permissions from the instance role
`msfg-dashboard-ec2-role` (there is no access key in `.env`). The policy is
checked in at `deploy/iam/plaud-recordings-policy.json`. From the repo root:

```bash
aws iam put-role-policy --role-name msfg-dashboard-ec2-role --policy-name PlaudRecordingsArchive --policy-document file://deploy/iam/plaud-recordings-policy.json
```

No restart needed; the role picks it up within a minute. Console alternative:
IAM → Roles → `msfg-dashboard-ec2-role` → Add permissions → Create inline
policy → JSON, paste the file's contents, name it `PlaudRecordingsArchive`.

For reference, the policy grants:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PlaudRecordingsArchive",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:AbortMultipartUpload",
        "s3:ListBucket",
        "s3:ListMultipartUploadParts"
      ],
      "Resource": [
        "arn:aws:s3:::msfg-plaud-recordings",
        "arn:aws:s3:::msfg-plaud-recordings/*"
      ]
    }
  ]
}
```

### Step 3 — Deploy the code (local)

Path: `/Users/zacharyzink/MSFG/index_page/msfg-dashboard` (wherever your clone of this repo lives). Merge the branch into `main` however you normally do (PR or local merge), then:

```bash
./deploy.sh --backend-only
```

That pulls `main` on the box, installs the one new package, and restarts the
backend. The restart runs migrations, which creates the `plaud_recordings`
table.

### Step 4 — Log in to Plaud on the server (local + the box)

The server has no browser, so the login bounces through an SSH tunnel: the
Plaud login page on your Mac redirects to `localhost:8199`, and the tunnel
carries that to the box.

**Local**, from anywhere. Nothing to replace:

```bash
ssh -i /Users/zacharyzink/MSFG/Security/msfg-mortgage-key.pem -L 8199:localhost:8199 ubuntu@52.203.186.217
```

You're now **on the box**. Install the Plaud command-line tool and log in:

```bash
npm install -g @plaud-ai/cli
plaud login
```

It will say it can't open a browser and print a URL. Copy that URL into a
browser on your Mac, sign in with the **same Apple login** you used for the
MCP (that's the account with your recordings), click Authorize. The terminal
on the box should say `Logged in successfully!`. Confirm:

```bash
plaud files
```

You should see your recent recordings. The token now lives at
`/home/ubuntu/.plaud/tokens.json` and the sync job keeps it refreshed. You can
close the tunnel; a normal SSH session is fine from here.

### Step 5 — Point the backend at the bucket (the box)

Path: `/home/ubuntu/msfg-backend/backend/.env`. Add one line:

```bash
PLAUD_S3_BUCKET=msfg-plaud-recordings
```

Optional: `PLAUD_S3_PREFIX=recordings` (folder in the bucket) and
`PLAUD_TOKEN_FILE=/home/ubuntu/.plaud/tokens.json` (only if you log in as a
different Linux user than the one running cron).

### Step 6 — Test it (the box)

Path: `/home/ubuntu/msfg-backend/backend`. Nothing to replace.

```bash
cd /home/ubuntu/msfg-backend/backend
node scripts/plaud-sync.js --check
```

That proves the login and prints the bucket it will use. Then:

```bash
node scripts/plaud-sync.js --dry-run
```

Lists what would be uploaded and where, writes nothing. Then copy just one:

```bash
node scripts/plaud-sync.js --limit 1
```

Check it landed. **Local**:

```bash
aws s3 ls s3://msfg-plaud-recordings/recordings/ --recursive --human-readable
```

Then run it with no flags to catch up on the rest of the recent page.

### Step 7 — Schedule it (the box)

Cron doesn't know about nvm, so it needs the full path to `node`. Get it:

```bash
which node
mkdir -p /home/ubuntu/logs
crontab -e
```

Add this line, **replacing `NODE_PATH` with what `which node` printed** (something like `/home/ubuntu/.nvm/versions/node/v20.19.0/bin/node`):

```
*/15 * * * * cd /home/ubuntu/msfg-backend/backend && flock -n /tmp/plaud-sync.lock NODE_PATH scripts/plaud-sync.js >> /home/ubuntu/logs/plaud-sync.log 2>&1
```

`flock -n` means a slow run can never overlap the next one. Watch it work:

```bash
tail -f /home/ubuntu/logs/plaud-sync.log
```

## Day to day

- **Where's my file?** `s3://msfg-plaud-recordings/recordings/<year>/<month>/`. Each object also carries the Plaud id, title and recorded time as S3 metadata.
- **Did it copy?** In MySQL: `SELECT name, status, s3_key, bytes, synced_at, last_error FROM plaud_recordings ORDER BY recorded_at DESC LIMIT 20;`
- **Something failed.** `last_error` says why. Fix the cause (usually permissions), then set that row's `status` back to `pending` and `attempts` to 0. The next run retries it.
- **Pull more history.** `node scripts/plaud-sync.js --pages 3` scans 150 recordings instead of 50. Plaud's API may cap how far back it will go.
- **Log in again.** If the log says "Run `plaud login`", the refresh token died (password change, Plaud revoked it). Repeat Step 4.

## Things worth knowing

- **This rides on Plaud's MCP/CLI login, not a public API.** Plaud doesn't hand out API apps to the public, so the official CLI's token is our way in. If Plaud changes that, this breaks. It's the only link, so it's worth knowing.
- **Recordings appear only after the recorder syncs to the phone app.** The job can't see audio that's still on the device.
- **No transcription is used or paid for.** Only the audio file is fetched.
- **Storage cost is small.** Plaud MP3s run roughly 1 MB per minute. Consider an S3 lifecycle rule to move objects to Glacier after 90 days once the downstream step has what it needs.
