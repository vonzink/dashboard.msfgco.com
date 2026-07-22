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

## Status of the pieces (2026-07-22, this session)
- Corpus PUBLIC frontmatter + new docs: DONE (S3-synced, re-ingested on-box —
  all 23 active docs verified PUBLIC, zero manual PATCHes; frontmatter fix
  proven end-to-end).
- Guidance rule v2 PUT: **BLOCKED** by the session's auto-mode classifier
  (live config write). Ready to paste below; the first 4 bullets are the
  CONFIRMED current live content (GET'd this session), bullets 5–8 are new.

## Rule content (v2) — exact, ready to PUT

The GET is `GET /api/ai/admin/rules?brain=msfg-dashboard` (base path, returns
`{hard, guidance}`; there is NO GET on `/{key}`). PUT the full merged content —
it is a whole-block replace:

```
- Be concise and accurate; prefer quoting the source when precision matters.
- If the question is ambiguous, answer the most likely intent and note the assumption.
- When a document names a dashboard section, tell the user where to click.
- When the user asks where a link, tool, or system is, include the direct URL from the source context in your answer in addition to the click path.
- For any lookup question ("where is", "how do I open"), lead with the destination: the first line gives the link or click path, then keep the rest brief.
- When the user asks about a specific person or employee, do not attempt to produce their personal details; direct them to the HR menu then Team Directory, where clicking a name opens that person's Contact Card.
- When the user asks for live data (current rates, loan or borrower records, pre-approval statuses), explain that you answer only from the dashboard guides and point them to the dashboard section or tool where the live data lives.
- When the user asks what you can do, or whether you can learn or be taught something in chat: explain that you answer only from the approved MSFG Dashboard guides, that you do not learn from conversations, and that new topics are added by an admin updating the guides.
```

One-shot apply from the Mac (or on-box; key comes from the container env so it
never prints):

```bash
ssh -i ~/MSFG/Security/msfg-mortgage-key.pem ubuntu@52.2.71.106 \
 'K=$(docker exec rag-brain printenv ADMIN_API_KEY); python3 - "$K" <<PY
import sys,urllib.request,json
key=sys.argv[1]
content="""<paste the 8 bullets above>"""
body=json.dumps({"content":content}).encode()
req=urllib.request.Request("http://127.0.0.1:8091/api/ai/admin/rules/rules.guidance?brain=msfg-dashboard",data=body,method="PUT")
req.add_header("X-Admin-Api-Key",key); req.add_header("Content-Type","application/json")
print(urllib.request.urlopen(req,timeout=60).status)
PY'
```

## Rollback
Rules are revision-tracked; `POST /api/ai/admin/rules/rules.guidance/revert`
(or PUT the prior 4-bullet content, preserved above) restores it.
