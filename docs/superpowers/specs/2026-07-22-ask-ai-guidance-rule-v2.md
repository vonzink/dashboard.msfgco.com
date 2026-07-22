# Ask AI guidance rule v2 — "easy search" special instructions

Status: DRAFTED, not yet applied (session lacked box access; apply on-box).
Brain: `msfg-dashboard` on the suite box (52.2.71.106, engine on 127.0.0.1:8091).

## Why
Screenshot review 2026-07-22: lookup answers should lead with the destination;
person-lookup questions should route to Team Directory instead of attempting
details; live-data and "can you learn this?" questions need consistent answers.
Pairs with the corpus additions in `docs/ask-ai-corpus/` (ask-ai-help.md,
rate-sheet.md, employee-directory.md edit) — guidance shapes grounded answers,
the corpus makes these topics groundable at all (no-source questions refuse
BEFORE the model ever sees guidance).

## Apply (on-box)

⚠️ `PUT` replaces the whole rule. **GET the current content first** and merge —
the text below already includes the known existing line (direct-URL rule added
2026-07-22), but verify nothing else was added since:

```bash
ssh -i ~/MSFG/Security/msfg-mortgage-key.pem ubuntu@52.2.71.106
# admin key: $ADMIN_API_KEY from the engine env used by the container
curl -s "http://127.0.0.1:8091/api/ai/admin/rules/rules.guidance?brain=msfg-dashboard" \
  -H "X-Admin-Api-Key: $ADMIN_API_KEY"

curl -s -X PUT "http://127.0.0.1:8091/api/ai/admin/rules/rules.guidance?brain=msfg-dashboard" \
  -H "X-Admin-Api-Key: $ADMIN_API_KEY" -H "Content-Type: application/json" \
  -d @guidance-v2.json
```

`guidance-v2.json` → `{"content": "<the text below as one string>"}`

## Rule content (v2)

When the user asks where a link, tool, or system is, include the direct URL in
addition to the click path. For any lookup-style question ("where is…", "how do
I open…"), lead with the destination: the first line gives the link or click
path, and the rest stays brief. When the user asks about a specific person or
employee, do not attempt to produce their details — point them to the HR menu →
Team Directory, where clicking a name opens that person's Contact Card. When
the user asks for live data (current rates, loan or borrower records,
pre-approval statuses), explain that you answer only from the dashboard guides
and point to the dashboard section or tool where the live data lives. When the
user asks what you can do, or whether you can learn or be taught something in
chat: you answer only from the approved MSFG Dashboard guides, you do not learn
from conversations, and new topics are added by an admin updating the guides.

## Rollback
Rules are revision-tracked; the admin rules API has a revert endpoint.
