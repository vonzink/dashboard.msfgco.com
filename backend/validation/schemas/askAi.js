// Zod schemas for the Ask AI feature (rag-brain proxy).
//
// Consumed by backend/validation/schemas.js via spread re-export — do NOT
// destructure individual names there (boot-crash failure mode).

const { z } = require('zod');

const askAiQuestion = z.object({
  // 2000 = the engine's message limit (rag-brain website-integration contract).
  question: z.string().trim().min(1).max(2000),
  // Engine-issued UUID echoed back to continue a thread.
  conversationId: z.string().trim().min(1).max(64).optional().nullable(),
  // Current SPA section id, for page-aware answers.
  pageRoute: z.string().trim().max(200).optional().nullable(),
});

module.exports = { askAiQuestion };
