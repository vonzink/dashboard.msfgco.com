# News & Announcements

Dashboard section: news

## What it is
The News & Announcements feed is a company-wide bulletin board on the dashboard home page. Anyone signed in can post an announcement — with rich text, links, file attachments, and an image — and it shows up as a card in a horizontally scrolling carousel for everyone. Each card shows the full posted date and time (e.g. "Jan 5, 2026, 3:45 PM"), not a relative "X hours ago" timestamp.

## How to find it
Scroll to the "News & Announcements" section at the top of the dashboard home page. Filter tabs (All, Rates, Events, Training, Alerts) sit above the card carousel, with left/right arrows to scroll through cards. A "View Archive" link at the bottom of the section opens the full history page (`announcements-history.html`).

## Common tasks

### Post an announcement
Click "Add" in the section header (visible to any signed-in user) to open the announcement editor. Enter a title and content, optionally add one or more links, attach up to 10 files, and add or AI-generate a graphic. Only up to 8 announcements stay "active" at once — posting past that limit auto-archives the oldest active one.

### Generate a graphic for a post
In the editor, use the image-generation option to have OpenAI create a graphic from your title and content instead of uploading your own. This requires a ChatGPT (OpenAI) API key configured on your profile's AI Keys tab — without one, generation fails with a message pointing you there.

### Filter the feed by category
Click a tab (Rates, Events, Training, Alerts) above the carousel to show only announcements in that category — categories are inferred from each announcement's icon or title. Click "All" to clear the filter.

### Delete an announcement
Admins can delete any announcement; the delete control on a card only shows up for admin accounts. (The backend also allows an announcement's original author to delete or edit their own post, but the dashboard's current UI doesn't expose an edit button.)

### Browse older announcements
Click "View Archive" to open the Announcement Archive page, which lists announcements that have aged out of the active carousel.

## FAQ
**Q: Who can post an announcement?**
A: Any signed-in user — posting isn't restricted to admins.

**Q: Why did my announcement disappear from the feed?**
A: Only 8 announcements stay active at a time. Once a ninth is posted, the oldest active one is automatically archived — find it on the Announcement Archive page, not deleted.

**Q: Can I edit an announcement after posting it?**
A: There's no edit button in the current UI. If you need a correction, ask an admin (or, if you're the author, delete it — deletion is allowed for the author) and repost.

**Q: What does the AI graphic generator need to work?**
A: A ChatGPT (OpenAI) API key added on your profile's AI Keys tab. Without one, the "generate image" option returns a configuration error instead of an image.
