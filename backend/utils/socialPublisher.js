/**
 * Social Media Publisher — Direct API integrations
 *
 * Publishes content directly to social media platforms using their APIs.
 * Each platform requires the user to have stored the appropriate credentials
 * in user_integrations via the Integrations settings panel.
 *
 * Supported platforms:
 *   - Facebook Pages  (Graph API v19.0 — page access token)
 *   - Instagram Business (Graph API v19.0 — via linked Facebook page)
 *   - LinkedIn (Community Management API — access token)
 *   - X / Twitter (v2 API — OAuth 2.0 bearer or user token)
 *   - TikTok (Content Posting API — access token, video only)
 */

const GRAPH_API = 'https://graph.facebook.com/v19.0';

// ─── Facebook Pages ────────────────────────────────────────────

async function publishToFacebook(accessToken, { text, hashtags, imageUrl }) {
  // First, get the page(s) the user manages
  const pagesRes = await fetch(`${GRAPH_API}/me/accounts?access_token=${encodeURIComponent(accessToken)}`);
  if (!pagesRes.ok) {
    const err = await pagesRes.json().catch(() => ({}));
    throw new Error(err.error?.message || `Facebook API error: ${pagesRes.status}`);
  }
  const pages = await pagesRes.json();
  if (!pages.data || pages.data.length === 0) {
    throw new Error('No Facebook Pages found for this access token. Make sure you have a Page connected.');
  }

  // Use the first page (could be extended to let users pick)
  const page = pages.data[0];
  const pageToken = page.access_token;
  const pageId = page.id;

  const fullText = hashtags && hashtags.length > 0
    ? `${text}\n\n${hashtags.join(' ')}`
    : text;

  const body = { message: fullText, access_token: pageToken };

  // If there's an image, post as photo; otherwise as text post
  let endpoint = `${GRAPH_API}/${pageId}/feed`;
  if (imageUrl) {
    endpoint = `${GRAPH_API}/${pageId}/photos`;
    body.url = imageUrl;
  }

  const postRes = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });

  if (!postRes.ok) {
    const err = await postRes.json().catch(() => ({}));
    throw new Error(err.error?.message || `Facebook post failed: ${postRes.status}`);
  }

  const result = await postRes.json();
  return { postId: result.id || result.post_id, platform: 'facebook' };
}

// ─── Instagram Business ────────────────────────────────────────

async function publishToInstagram(accessToken, { text, hashtags, imageUrl }) {
  if (!imageUrl) {
    throw new Error('Instagram requires an image URL to publish. Generate an image first.');
  }

  // Get Instagram Business account linked to Facebook Page
  const pagesRes = await fetch(
    `${GRAPH_API}/me/accounts?fields=instagram_business_account&access_token=${encodeURIComponent(accessToken)}`
  );
  if (!pagesRes.ok) {
    const err = await pagesRes.json().catch(() => ({}));
    throw new Error(err.error?.message || `Instagram API error: ${pagesRes.status}`);
  }
  const pages = await pagesRes.json();

  const igAccount = pages.data?.find(p => p.instagram_business_account)?.instagram_business_account;
  if (!igAccount) {
    throw new Error('No Instagram Business account found. Link your Instagram to a Facebook Page first.');
  }

  const fullCaption = hashtags && hashtags.length > 0
    ? `${text}\n\n${hashtags.join(' ')}`
    : text;

  // Step 1: Create media container
  const containerRes = await fetch(`${GRAPH_API}/${igAccount.id}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_url: imageUrl,
      caption: fullCaption,
      access_token: accessToken,
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!containerRes.ok) {
    const err = await containerRes.json().catch(() => ({}));
    throw new Error(err.error?.message || `Instagram container creation failed: ${containerRes.status}`);
  }

  const container = await containerRes.json();

  // Step 2: Publish the container
  const publishRes = await fetch(`${GRAPH_API}/${igAccount.id}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      creation_id: container.id,
      access_token: accessToken,
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!publishRes.ok) {
    const err = await publishRes.json().catch(() => ({}));
    throw new Error(err.error?.message || `Instagram publish failed: ${publishRes.status}`);
  }

  const result = await publishRes.json();
  return { postId: result.id, platform: 'instagram' };
}

// ─── LinkedIn ──────────────────────────────────────────────────

async function publishToLinkedIn(accessToken, { text, hashtags, imageUrl }) {
  // Get the user's LinkedIn profile URN
  const profileRes = await fetch('https://api.linkedin.com/v2/userinfo', {
    headers: { 'Authorization': `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10000),
  });

  if (!profileRes.ok) {
    const err = await profileRes.json().catch(() => ({}));
    throw new Error(err.message || `LinkedIn API error: ${profileRes.status}`);
  }

  const profile = await profileRes.json();
  const personUrn = `urn:li:person:${profile.sub}`;

  const fullText = hashtags && hashtags.length > 0
    ? `${text}\n\n${hashtags.join(' ')}`
    : text;

  const postBody = {
    author: personUrn,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: { text: fullText },
        shareMediaCategory: imageUrl ? 'IMAGE' : 'NONE',
      },
    },
    visibility: {
      'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
    },
  };

  const postRes = await fetch('https://api.linkedin.com/v2/ugcPosts', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
    },
    body: JSON.stringify(postBody),
    signal: AbortSignal.timeout(15000),
  });

  if (!postRes.ok) {
    const err = await postRes.json().catch(() => ({}));
    throw new Error(err.message || `LinkedIn post failed: ${postRes.status}`);
  }

  const postId = postRes.headers.get('x-restli-id') || 'unknown';
  return { postId, platform: 'linkedin' };
}

// ─── X (Twitter) ───────────────────────────────────────────────

async function publishToTwitter(bearerToken, { text, hashtags }) {
  const fullText = hashtags && hashtags.length > 0
    ? `${text}\n\n${hashtags.join(' ')}`
    : text;

  // Truncate to 280 chars for Twitter
  const tweetText = fullText.length > 280 ? fullText.slice(0, 277) + '...' : fullText;

  const postRes = await fetch('https://api.twitter.com/2/tweets', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${bearerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: tweetText }),
    signal: AbortSignal.timeout(15000),
  });

  if (!postRes.ok) {
    const err = await postRes.json().catch(() => ({}));
    const detail = err.detail || err.errors?.[0]?.message || `Twitter API error: ${postRes.status}`;
    throw new Error(detail);
  }

  const result = await postRes.json();
  return { postId: result.data?.id, platform: 'twitter' };
}

// ─── TikTok ────────────────────────────────────────────────────

async function publishToTikTok(accessToken, { text, hashtags }) {
  // TikTok Content Posting API is video-only and requires a video URL.
  // For text/image posts, TikTok doesn't support direct API posting.
  // This is a placeholder that returns a helpful error.
  throw new Error(
    'TikTok requires video content for direct API publishing. ' +
    'Use the webhook method (n8n/Zapier) for TikTok, or generate a video first.'
  );
}

// ─── Dispatcher ────────────────────────────────────────────────

const PUBLISHERS = {
  facebook: publishToFacebook,
  instagram: publishToInstagram,
  linkedin: publishToLinkedIn,
  twitter: publishToTwitter,
  x: publishToTwitter, // alias
  tiktok: publishToTikTok,
};

/**
 * Publish content to a social media platform using its direct API.
 *
 * @param {string} platform - Platform identifier
 * @param {string} credential - Decrypted API key/access token
 * @param {object} content - { text, hashtags, imageUrl }
 * @returns {Promise<{ postId: string, platform: string }>}
 */
async function publishDirect(platform, credential, content) {
  const publisher = PUBLISHERS[platform];
  if (!publisher) {
    throw new Error(`Direct publishing not supported for ${platform}. Use webhook method instead.`);
  }
  return publisher(credential, content);
}

/**
 * Check if a platform supports direct API publishing.
 */
function supportsDirectPublish(platform) {
  return platform in PUBLISHERS && platform !== 'tiktok';
}

module.exports = { publishDirect, supportsDirectPublish };
