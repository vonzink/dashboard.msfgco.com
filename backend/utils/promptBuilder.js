/**
 * Prompt builder — assembles a final ChatGPT prompt from:
 *   1. The user's (or company-default) prompt template
 *   2. Platform-specific constraints
 *   3. The keyword suggestion to write about
 */

// Hard platform constraints (character limits, format requirements)
const PLATFORM_CONSTRAINTS = {
  facebook: {
    name: 'Facebook',
    maxLength: 500,
    format: '2-3 short paragraphs. Conversational. End with a call-to-action question.',
  },
  instagram: {
    name: 'Instagram',
    maxLength: 2200,
    format: 'Start with a hook line. Use line breaks for readability. End with 5-10 hashtags. Include a CTA.',
  },
  x: {
    name: 'X (Twitter)',
    maxLength: 270,
    format: 'One strong insight or tip. Under 270 characters. 1-2 hashtags max. Punchy and retweetable.',
  },
  linkedin: {
    name: 'LinkedIn',
    maxLength: 1300,
    format: 'Start with a bold statement or statistic. Short paragraphs. End with a question. Professional tone.',
  },
  tiktok: {
    name: 'TikTok',
    maxLength: 300,
    format: 'Short catchy caption. Casual/fun. Hook first line. 3-5 trending hashtags. Suggest video concept in brackets.',
  },
};

/**
 * Build the messages array for the OpenAI chat completion.
 *
 * @param {object} params
 * @param {string} params.suggestion  - The keyword/topic to write about
 * @param {string} params.platform    - facebook | instagram | x | linkedin | tiktok
 * @param {object} params.template    - Row from prompt_templates table (may be null)
 * @param {string} [params.additionalInstructions] - One-off extra instructions from the user
 * @returns {{ messages: Array, model: string, temperature: number }}
 */
function buildPrompt({ suggestion, platform, template, additionalInstructions }) {
  const constraints = PLATFORM_CONSTRAINTS[platform] || PLATFORM_CONSTRAINTS.facebook;

  // ── System message ────────────────────────────────────────────
  const systemParts = [];

  // Base identity from template (or sensible default)
  if (template?.system_prompt) {
    systemParts.push(template.system_prompt);
  } else {
    systemParts.push(
      'You are a social media content creator for a mortgage lending company. ' +
      'You create educational, engaging content that helps people understand the home buying and mortgage process.'
    );
  }

  // Audience
  if (template?.audience) {
    systemParts.push(`Target audience: ${template.audience}`);
  }

  // Tone
  if (template?.tone) {
    systemParts.push(`Tone: ${template.tone}`);
  }

  // User-defined rules
  if (template?.rules) {
    systemParts.push(`Rules:\n${template.rules}`);
  }

  const systemMessage = systemParts.join('\n\n');

  // ── User message ──────────────────────────────────────────────
  const userParts = [];

  userParts.push(`Generate a ${constraints.name} post about: "${suggestion}"`);
  userParts.push(
    `Platform requirements:\n` +
    `- ${constraints.format}\n` +
    `- Maximum ${constraints.maxLength} characters for the main text (not counting hashtags)`
  );

  // Few-shot example if provided
  if (template?.example_post) {
    userParts.push(`Here is an example of a good post in the style I want:\n---\n${template.example_post}\n---`);
  }

  // One-off instructions for this generation
  if (additionalInstructions) {
    userParts.push(`Additional instructions for this post: ${additionalInstructions}`);
  }

  // Output format instruction
  userParts.push(
    'Respond in this exact JSON format (no markdown, no code blocks):\n' +
    '{"text": "your post text here", "hashtags": ["hashtag1", "hashtag2"]}'
  );

  const userMessage = userParts.join('\n\n');

  return {
    messages: [
      { role: 'system', content: systemMessage },
      { role: 'user', content: userMessage },
    ],
    model: template?.model || 'gpt-4o-mini',
    temperature: template?.temperature != null ? parseFloat(template.temperature) : 0.8,
  };
}

module.exports = { buildPrompt, PLATFORM_CONSTRAINTS };
