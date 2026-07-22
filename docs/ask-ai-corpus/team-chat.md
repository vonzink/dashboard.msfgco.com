---
visibility: PUBLIC
---
# Team Chat

Dashboard section: (none — bottom-right floating button → Team Chat tab)

## What it is
Team Chat is the dashboard's internal messaging channel — a single shared feed where everyone on the team can post messages, attach files, and tag messages by topic. It lives inside the same floating assistant panel as Ask AI, as the second tab. Messages update in real time for everyone viewing the panel (no refresh needed).

## How to find it
Click the round floating button in the bottom-right corner of any dashboard page (it shows a robot icon and an unread-count badge). The panel opens with two tabs at the top: "Ask AI" and "Team Chat" — click "Team Chat" to switch. The panel also has a "Manage Tags" button (tag icon) and a close button in its header.

## Common tasks

### Send a message
Type in the message box at the bottom of the Team Chat pane and click Send (or press Enter). Your name/initials and a timestamp post with the message, and it appears instantly for every other open session.

### Attach a file to a message
Click the paperclip icon next to the message box to pick one or more files, then send. Each file must be 10MB or smaller. Files upload to S3 and appear as attachments on the message; anyone can download them, and the sender (or an admin) can delete an attachment afterward.

### Tag a message and filter by tag
Before sending, use the "Attach tags" picker bar above the input to tag the message you're about to send. Use the tag filter bar at the top of the message list to show only messages carrying a specific tag. Any user can also edit the tags on an already-sent message.

### Create or delete a tag
Click "Manage Tags" (tag icon in the panel header) to open the tag manager. Give a new tag a name and color to create it, or click the trash icon next to an existing tag to delete it — deleting a tag removes it from every message that had it.

### Edit or delete your own message
Messages you sent show edit/delete controls; editing marks the message as edited, and deleting asks for confirmation first. You can only edit or delete your own messages — except admins, who can delete anyone's message.

## FAQ
**Q: Can I delete someone else's message?**
A: Only if you're an admin. Regular users can only edit or delete their own messages.

**Q: Is there a limit on attached files?**
A: Each file must be 10MB or smaller; you can attach multiple files to one message.

**Q: Who can create or delete tags?**
A: Any authenticated user — tags aren't owned by a single person, so anyone can create a new one or delete an existing one via "Manage Tags."

**Q: Do I need to refresh to see new messages?**
A: No — Team Chat pushes new messages, edits, deletes, and tag changes over a live connection while the panel is open.
