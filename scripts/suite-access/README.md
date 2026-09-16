# suite-access probe

Checks whether a dashboard login token will be accepted by the msfg-suite API. Read-only.

## Get a token
1. Log in at https://dashboard.msfgco.com.
2. DevTools → Console: `copy(localStorage.getItem('auth_token'))`
3. In a terminal (token stays out of shell history with a leading space):
   ` export SUITE_PROBE_TOKEN='<paste>'`

## Run
```bash
node --test scripts/suite-access/            # unit tests
node scripts/suite-access/probe.mjs           # prod suite, dashboard origin
node scripts/suite-access/probe.mjs --api http://localhost:8080 --origin http://localhost:5190
```

Never commit or paste tokens into docs. Unset when done: `unset SUITE_PROBE_TOKEN`.
