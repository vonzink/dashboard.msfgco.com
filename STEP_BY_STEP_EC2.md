# Step-by-Step EC2 Setup - You Are Here!

## Current Status
✅ You're successfully connected to EC2 as `ubuntu` user
⏭️ Next: Check if Node.js is installed

---

## STEP 1: Check Node.js Installation

Run this command on your EC2 terminal:

```bash
node --version
```

**What should happen:**
- If you see a version number (like `v20.x.x`): ✅ Node.js is installed, skip to Step 2
- If you see `command not found`: ⏭️ We need to install Node.js (go to Step 1.5)

---

## STEP 1.5: Install Node.js (Only if needed)

Run these commands one at a time:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
```

Press Enter, wait for it to complete.

Then:

```bash
sudo apt-get install -y nodejs
```

Press Enter, wait for installation.

Then verify:

```bash
node --version
npm --version
```

You should see version numbers for both.

---

## STEP 2: Navigate to Home Directory

```bash
cd ~
pwd
```

Should show: `/home/ubuntu`

---

## STEP 3: Create Backend Directory

```bash
mkdir -p msfg-backend
cd msfg-backend
```

---

## Next Steps (After Node.js is Ready)

We'll transfer the backend code to EC2 and set it up.

---

**Run the commands above and tell me what you see!**

