const LIMITS = Object.freeze({
  master_html: 250 * 1024,
  master_css: 500 * 1024,
  slide_html: 250 * 1024,
  slide_css: 250 * 1024,
  slide_javascript: 500 * 1024,
  request: 2 * 1024 * 1024,
  speaker_notes: 100 * 1024,
});

module.exports = { LIMITS };
