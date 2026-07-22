# Content Studio

Dashboard section: (none — top nav "Marketing" menu → "Content Studio")

## What it is
Content Studio uses AI (OpenAI) to draft social media posts for multiple platforms — Facebook, Instagram, X, LinkedIn, and TikTok — from a single topic, then helps you review and publish them. It opens as a modal with two tabs: "Create" (generate new posts) and "My Posts" (your queue of drafted/generated posts).

## How to find it
Click "Marketing" in the top navigation bar, then "Content Studio" under the "Content Engine" heading in the dropdown.

## Common tasks

### Generate posts for multiple platforms at once
On the "Create" tab, type what you want to post about in the topic field, optionally add special instructions (tone, a promo to mention, a target audience), toggle on the platforms you want, and click "Generate Posts." The AI writes a separate, platform-appropriate post (with hashtags, respecting each platform's length limit) for every platform you selected.

### Publish a generated post
Each generated result shows a "Publish" button for its platform. Click it to publish that one post. To publish everything you just generated in one click, use "Publish All" instead.

### Review your post queue
Switch to the "My Posts" tab to see stats and a list of everything you've generated — drafts, approved, scheduled, published, and failed posts.

### Fix a failed or draft post
Posts stuck in draft or failed status show options to retry or edit from the "My Posts" queue instead of regenerating from scratch.

## FAQ
**Q: Why does Content Studio say I need an API key configured?**
A: Generating posts requires your own OpenAI API key, added under Settings → Integrations. Without one, "Generate Posts" fails with a message pointing you to add it there.

**Q: How does publishing actually post to Facebook/Instagram/etc.?**
A: It tries, in order: your own connected platform credential for that network (added in Settings → Integrations), then an n8n automation webhook, then a Zapier webhook. If none of those are configured for a platform, publishing fails with a message to add a platform API key or automation webhook in Settings → Integrations.

**Q: Which platforms can I generate content for?**
A: Facebook, Instagram, X, LinkedIn, and TikTok.

**Q: What happens to a post after I generate it?**
A: It's tracked in your queue with a status — draft, approved, scheduled, published, or failed — visible on the "My Posts" tab, and you can act on it (edit, approve, publish, or retry) from there instead of only from the generation results.
