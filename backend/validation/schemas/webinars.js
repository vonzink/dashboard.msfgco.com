const { z } = require('zod');

// A webinar's URL name on the webinar site: lowercase words joined by single
// dashes. Saved slide edits are stored under it.
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const webinarSlug = z.string().trim().min(1).max(190).regex(SLUG);

module.exports = { webinarSlug };
