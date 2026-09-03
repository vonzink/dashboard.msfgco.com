# How We Connected Plaud to S3 (Plain-English Recap)

Date set up: September 2, 2026

This is the story of what we did, in order, and why. The technical reference
with every command lives in `PLAUD_SYNC.md`. This one is for remembering how
it all fits together.

## The goal

The Plaud recorder captures calls and meetings. We wanted every recording's
audio file (the MP3) to land in our own AWS S3 bucket automatically, so the
audio lives somewhere we control and our own transcriber can read it later.
We did not want to use or pay for Plaud's transcription.

## What we found out first

- **Plaud has no public API you can sign up for.** Their OAuth API is a closed
  beta. Requests for access go to a waitlist.
- **But Plaud ships an official command-line tool** (`plaud`) and an MCP server
  for AI assistants. Both log in through your Plaud account and talk to the
  same API. The login creates a token file that can be reused.
- So the plan became: log the server in with Plaud's own tool once, and have
  our sync job reuse that login.

## The pieces

```
Plaud recorder ──phone app syncs──▶ Plaud cloud
                                         │
                       every 30 min: our sync job on the EC2 box
                                         │
                                         ▼
                s3://msfg-plaud-recordings/recordings/2026/09/20260903-025238_<id>.mp3
                                         │
                       plus one row per file in the plaud_recordings table
```

- **The bucket:** `msfg-plaud-recordings` in us-west-2, no public access.
- **The sync job:** part of the dashboard backend, `backend/scripts/plaud-sync.js`.
  It asks Plaud for recent recordings, skips ones it already copied, and
  streams each new MP3 straight from Plaud into the bucket.
- **The tracking table:** `plaud_recordings` in the dashboard database. It's
  how the job knows what's already been copied, and where failures show up.
- **The schedule:** cron on the EC2 box, every 30 minutes.

## The steps we took

### 1. Made the bucket (AWS console)

Created `msfg-plaud-recordings` in US West (Oregon) with "Block all public
access" left on. Nothing about this bucket needs to be reachable from the
internet.

### 2. Gave the server permission to write to it (Mac terminal)

The EC2 box doesn't use an access key. It gets its AWS permissions from a
role called `msfg-dashboard-ec2-role`. We attached a small policy to that role
that allows reading and writing to just this one bucket. The policy is saved
in the repo at `deploy/iam/plaud-recordings-policy.json`.

### 3. Built and deployed the code (Mac terminal)

The sync job, the Plaud client, the database migration, tests and docs were
written on a branch, merged into `main` through a pull request, and deployed
with `./deploy.sh --backend-only`. The backend restart ran the migration
that created the `plaud_recordings` table.

### 4. Logged the server in to Plaud (this was the fiddly part)

Plaud's login opens a browser and then sends the browser back to
`localhost:8199` on the machine that started the login. A server has no
browser, so we did two things:

- **Opened an SSH tunnel from the Mac** so that `localhost:8199` on the Mac
  forwards to the server. Started in its own terminal window with the `-N`
  flag, which just sits there holding the tunnel open (it looks stuck, it
  isn't).
- **Captured the login link instead of opening it.** The `plaud login` command
  thinks it opened a browser and never prints the link. We gave it a tiny
  helper script as its "browser" that writes the link to a file, then copied
  the link into a browser on the Mac.

Two gotchas we hit along the way:

- `npm install -g @plaud-ai/cli` needs `sudo` on this box because Node is
  installed system-wide.
- Running `plaud login` in the background with `&` gets it paused by the
  shell. It has to be started with `nohup`, with input from `/dev/null` and
  output to a log file.

After clicking Allow on Plaud's screen (logged in as vonzink, "Personal"
workspace), the server printed "Logged in successfully". The token now lives
at `/home/ubuntu/.plaud/tokens.json` and the sync job keeps it refreshed. The
tunnel was only needed for that one login.

### 5. Told the backend which bucket to use (on the box)

Added one line to `/home/ubuntu/msfg-backend/backend/.env`:

```
PLAUD_S3_BUCKET=msfg-plaud-recordings
```

### 6. Tested it in stages (on the box)

From `/home/ubuntu/msfg-backend/backend`:

1. `node scripts/plaud-sync.js --check` proved the login, the API, and the
   bucket setting all lined up.
2. `node scripts/plaud-sync.js --dry-run` listed all 10 recordings and where
   each would go, without touching anything.
3. `node scripts/plaud-sync.js --limit 1` copied one 6-second test clip.
   We confirmed it in the bucket with `aws s3 ls`.
4. `node scripts/plaud-sync.js` copied the other nine. About 60 MB total,
   14 seconds.

### 7. Put it on a schedule (on the box)

Added a cron line that runs the job every 30 minutes, logs to
`/home/ubuntu/logs/plaud-sync.log`, and uses `flock` so two runs can never
overlap.

## How to check on it

- **Is it running?** `cat /home/ubuntu/logs/plaud-sync.log` on the box. Each
  run writes a "scan complete" line and a "done" line. `skipped: N` with
  `uploaded: 0` is the normal, boring result when nothing is new.
- **Where's a file?** `aws s3 ls s3://msfg-plaud-recordings/recordings/ --recursive --human-readable` from the Mac.
- **What got copied when?** In the database:
  `SELECT name, status, s3_key, bytes, synced_at FROM plaud_recordings ORDER BY recorded_at DESC;`

## If it breaks

- **Log says "Run `plaud login`".** The saved login expired or was revoked.
  Repeat step 4 (tunnel plus the helper-script login).
- **A row shows `status = failed`.** Read its `last_error`. Fix the cause, set
  the row back to `pending` with `attempts = 0`, and the next run retries it.
- **A recording never shows up.** The recorder has to sync to the phone app
  first. Until then Plaud has no audio to give us, and the job leaves the row
  `pending` and keeps checking.

## Things to remember

- This rides on Plaud's own login tool, not a public API. If Plaud changes
  how that works, this is the thing that breaks.
- Storage is cheap. Plaud MP3s are about 14 MB per hour of audio, so a year of
  daily hour-long calls is roughly 5 GB.
- The next step, when ready, is pointing the transcriber at the bucket. The
  files, the folder layout, and the metadata on each object (Plaud id, title,
  recorded time) are all there waiting for it.
