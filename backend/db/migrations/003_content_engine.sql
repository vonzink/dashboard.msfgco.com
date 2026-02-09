-- ============================================================
-- MSFG Content Engine Schema
-- Migration 003 - Social Media Content Generation & Publishing
-- ============================================================

-- Each user's external service credentials (AES-256-GCM encrypted)
CREATE TABLE IF NOT EXISTS user_integrations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    service VARCHAR(50) NOT NULL,           -- openai, canva, elevenlabs, midjourney, n8n, zapier, facebook, instagram, twitter, linkedin, tiktok
    credential_type VARCHAR(30) NOT NULL,   -- api_key, oauth_token, webhook_url
    encrypted_value TEXT NOT NULL,           -- AES-256-GCM encrypted
    iv VARCHAR(64) NOT NULL,                -- initialization vector (hex)
    auth_tag VARCHAR(64) NOT NULL,          -- GCM auth tag (hex)
    label VARCHAR(100),                     -- user-friendly label
    is_active BOOLEAN DEFAULT TRUE,
    last_tested_at DATETIME NULL,
    last_test_result VARCHAR(10) NULL,      -- pass, fail
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_user_service (user_id, service, credential_type),
    INDEX idx_user (user_id),
    INDEX idx_service (service)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Prompt templates: company-wide defaults (user_id=NULL) + per-user overrides
CREATE TABLE IF NOT EXISTS prompt_templates (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NULL,                       -- NULL = company-wide default
    platform VARCHAR(20) NOT NULL,          -- facebook, instagram, x, linkedin, tiktok, all
    name VARCHAR(255) NOT NULL,
    system_prompt TEXT NOT NULL,
    tone VARCHAR(100),                      -- professional, casual, educational, motivational
    audience VARCHAR(255),                  -- first-time homebuyers, realtors, etc.
    rules TEXT,                             -- user-defined dos and don'ts
    example_post TEXT,                      -- optional example for few-shot prompting
    model VARCHAR(50) DEFAULT 'gpt-4o-mini',-- which OpenAI model to use
    temperature DECIMAL(2,1) DEFAULT 0.8,
    is_default BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_platform (user_id, platform),
    INDEX idx_default (is_default)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Generated content with full lifecycle tracking
CREATE TABLE IF NOT EXISTS content_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    keyword VARCHAR(500) NOT NULL,
    suggestion VARCHAR(500) NOT NULL,
    platform VARCHAR(20) NOT NULL,          -- facebook, instagram, x, linkedin, tiktok
    prompt_template_id INT NULL,
    status VARCHAR(30) DEFAULT 'draft',     -- draft, pending_review, approved, scheduled, posted, failed, archived
    text_content TEXT NOT NULL,
    hashtags JSON,
    image_s3_key VARCHAR(500) NULL,
    image_source VARCHAR(30) NULL,          -- satori, canva, midjourney
    video_s3_key VARCHAR(500) NULL,
    video_source VARCHAR(30) NULL,          -- elevenlabs, runway, other
    scheduled_at DATETIME NULL,
    posted_at DATETIME NULL,
    post_external_id VARCHAR(255) NULL,     -- ID from the social platform after posting
    approved_by INT NULL,
    approved_at DATETIME NULL,
    review_notes TEXT NULL,
    automation_method VARCHAR(20) NULL,     -- zapier, n8n, direct_api
    error_message TEXT NULL,                -- last error if posting failed
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (prompt_template_id) REFERENCES prompt_templates(id) ON DELETE SET NULL,
    FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_user_status (user_id, status),
    INDEX idx_platform (platform),
    INDEX idx_scheduled (scheduled_at),
    INDEX idx_keyword (keyword(100)),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Audit log for content lifecycle events
CREATE TABLE IF NOT EXISTS content_audit_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    content_id INT NOT NULL,
    user_id INT NOT NULL,
    action VARCHAR(30) NOT NULL,            -- created, edited, approved, rejected, scheduled, posted, failed, archived
    details JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (content_id) REFERENCES content_items(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_content (content_id),
    INDEX idx_user (user_id),
    INDEX idx_action (action),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Keyword search cache (avoid hitting Google too frequently for same terms)
CREATE TABLE IF NOT EXISTS keyword_cache (
    id INT AUTO_INCREMENT PRIMARY KEY,
    keyword VARCHAR(500) NOT NULL,
    language VARCHAR(10) DEFAULT 'en',
    country VARCHAR(10) DEFAULT 'US',
    results JSON NOT NULL,                  -- cached autocomplete results
    expires_at DATETIME NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_keyword_locale (keyword(200), language, country),
    INDEX idx_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Insert default company-wide prompt templates
INSERT INTO prompt_templates (user_id, platform, name, system_prompt, tone, audience, rules, is_default, is_active)
VALUES
(NULL, 'all', 'MSFG Default', 
 'You are a social media content creator for Main Street Financial Group (MSFG), a mortgage lending company. You create educational, engaging content that helps people understand the home buying and mortgage process. You are knowledgeable, approachable, and trustworthy.',
 'professional',
 'Homebuyers, homeowners, real estate professionals',
 'Never mention competitor names by name.\nAlways be educational first, promotional second.\nDo not make promises about rates or approvals.\nInclude NMLS information when appropriate.\nAvoid jargon unless you explain it.\nDo not use clickbait or fear-based language.',
 TRUE, TRUE),

(NULL, 'facebook', 'Facebook Default',
 'You are a social media content creator for Main Street Financial Group (MSFG). Create engaging Facebook posts that spark conversation and shares. Use a conversational, friendly tone. Posts should feel like helpful advice from a trusted friend who happens to be a mortgage expert.',
 'conversational',
 'Homebuyers and homeowners',
 'Use emojis moderately (2-4 per post).\nInclude a call-to-action question at the end.\nKeep to 2-3 short paragraphs.\nMax 500 characters for main text.',
 TRUE, TRUE),

(NULL, 'instagram', 'Instagram Default',
 'You are a social media content creator for Main Street Financial Group (MSFG). Create Instagram captions that are visually-oriented and engaging. Start with a strong hook line. Focus on education and inspiration.',
 'inspirational',
 'First-time homebuyers, millennials, Gen Z',
 'Start with a hook line that stops the scroll.\nUse line breaks for readability.\nEnd with 5-10 relevant hashtags.\nInclude emojis strategically.\nInclude a CTA.\nMax 2200 characters.',
 TRUE, TRUE),

(NULL, 'x', 'X/Twitter Default',
 'You are a social media content creator for Main Street Financial Group (MSFG). Create punchy, concise tweets that deliver one strong insight or tip. Make it retweetable.',
 'concise',
 'Real estate professionals, homebuyers',
 'Under 270 characters total.\nOne strong insight or tip per tweet.\nNo fluff.\n1-2 hashtags maximum.\nMake it retweetable and quotable.',
 TRUE, TRUE),

(NULL, 'linkedin', 'LinkedIn Default',
 'You are a mortgage industry thought leader at Main Street Financial Group (MSFG). Create professional LinkedIn posts that demonstrate expertise and spark industry discussion. Use data, insights, and professional experience.',
 'thought-leadership',
 'Real estate professionals, financial advisors, industry peers',
 'Start with a bold statement or statistic.\nUse short paragraphs with line breaks.\nEnd with a question to spark comments.\nMinimal to no emojis.\nProfessional, authoritative tone.\nMax 1300 characters.',
 TRUE, TRUE),

(NULL, 'tiktok', 'TikTok Default',
 'You are a social media content creator for Main Street Financial Group (MSFG). Create short, catchy TikTok captions and suggest video concepts. Content should be fun, educational, and trend-aware.',
 'casual',
 'First-time homebuyers, Gen Z, millennials',
 'Short, catchy caption for a video.\nCasual, fun tone.\nHook in the first line.\n3-5 trending-style hashtags.\nSuggest a video concept in brackets.\nMax 300 characters.',
 TRUE, TRUE)

ON DUPLICATE KEY UPDATE updated_at = NOW();
