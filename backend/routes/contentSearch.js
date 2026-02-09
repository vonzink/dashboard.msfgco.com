/**
 * /api/content/search — Google Autocomplete keyword research
 *
 * POST / — search for keyword suggestions (with caching)
 */
const express = require('express');
const router = express.Router();
const db = require('../db/connection');

const GOOGLE_SUGGEST_URL = 'https://suggestqueries.google.com/complete/search';
const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 200;
const CACHE_HOURS = 24;

// ── Modifier definitions ────────────────────────────────────────
const QUESTION_WORDS = ['who', 'what', 'where', 'when', 'why', 'how', 'can', 'will', 'are', 'is', 'which', 'does'];
const PREPOSITIONS = ['for', 'with', 'near', 'without', 'to', 'like', 'versus', 'vs', 'and', 'or', 'but', 'than'];
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz'.split('');

function buildAllQueries(keyword) {
  const trimmed = keyword.trim().toLowerCase();
  const seen = new Set();
  const queries = [];

  for (const word of QUESTION_WORDS) {
    const q = `${word} ${trimmed}`;
    if (!seen.has(q)) { seen.add(q); queries.push({ query: q, modifier: word, category: 'questions' }); }
  }
  for (const word of PREPOSITIONS) {
    const q = `${trimmed} ${word}`;
    if (!seen.has(q)) { seen.add(q); queries.push({ query: q, modifier: word, category: 'prepositions' }); }
  }
  for (const letter of ALPHABET) {
    const q = `${trimmed} ${letter}`;
    if (!seen.has(q)) { seen.add(q); queries.push({ query: q, modifier: letter, category: 'alphabetical' }); }
  }

  return queries;
}

async function fetchSuggestions(query, hl, gl) {
  const url = new URL(GOOGLE_SUGGEST_URL);
  url.searchParams.set('client', 'firefox');
  url.searchParams.set('q', query);
  url.searchParams.set('hl', hl);
  url.searchParams.set('gl', gl);

  try {
    const response = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data[1]) ? data[1] : [];
  } catch {
    return [];
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── POST / — keyword search ─────────────────────────────────────
router.post('/', async (req, res, next) => {
  try {
    const keyword = (req.body.keyword || '').trim().toLowerCase();
    const language = req.body.language || 'en';
    const country = req.body.country || 'US';

    if (!keyword) {
      return res.status(400).json({ error: 'keyword is required' });
    }

    // ── Check cache ──
    try {
      const [cached] = await db.query(
        `SELECT results FROM keyword_cache
         WHERE keyword = ? AND language = ? AND country = ? AND expires_at > NOW()
         LIMIT 1`,
        [keyword, language, country]
      );

      if (cached.length > 0) {
        const results = typeof cached[0].results === 'string'
          ? JSON.parse(cached[0].results)
          : cached[0].results;
        return res.json({ results, cached: true });
      }
    } catch {
      // Cache miss or parse error — proceed with live query
    }

    // ── Live query ──
    const queries = buildAllQueries(keyword);
    const groups = [];

    for (let i = 0; i < queries.length; i += BATCH_SIZE) {
      const batch = queries.slice(i, i + BATCH_SIZE);

      const batchResults = await Promise.allSettled(
        batch.map(q => fetchSuggestions(q.query, language, country))
      );

      batchResults.forEach((result, idx) => {
        if (result.status === 'fulfilled' && result.value.length > 0) {
          groups.push({
            modifier: batch[idx].modifier,
            category: batch[idx].category,
            suggestions: result.value,
          });
        }
      });

      if (i + BATCH_SIZE < queries.length) {
        await delay(BATCH_DELAY_MS);
      }
    }

    const results = {
      keyword,
      timestamp: Date.now(),
      groups,
      totalSuggestions: groups.reduce((sum, g) => sum + g.suggestions.length, 0),
    };

    // ── Save to cache ──
    try {
      await db.query(
        `INSERT INTO keyword_cache (keyword, language, country, results, expires_at)
         VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? HOUR))
         ON DUPLICATE KEY UPDATE
           results = VALUES(results),
           expires_at = VALUES(expires_at),
           created_at = NOW()`,
        [keyword, language, country, JSON.stringify(results), CACHE_HOURS]
      );
    } catch {
      // Non-fatal — caching failure shouldn't break the response
    }

    res.json({ results, cached: false });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
