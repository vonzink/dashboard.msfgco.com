-- Saved edits for the static webinar decks on msfgmortgage.com.
-- One row per edited slide (its HTML, its own CSS and its own JS); deleting the
-- row restores the deck's original. The row whose slide_id is '_master' holds
-- the deck-wide Master CSS in its css column.
-- Deliberately independent of the Webinar Studio tables: the static decks are
-- identified by their site slug and each slide's id in content/slides.js.
CREATE TABLE IF NOT EXISTS webinar_slide_edits (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    slug VARCHAR(190) NOT NULL,
    slide_id VARCHAR(190) NOT NULL,
    html MEDIUMTEXT NOT NULL,
    css MEDIUMTEXT NOT NULL,
    js MEDIUMTEXT NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_webinar_slide_edit (slug, slide_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
