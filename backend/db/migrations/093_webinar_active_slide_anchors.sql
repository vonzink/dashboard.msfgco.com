ALTER TABLE webinar_slides
    ADD COLUMN active_anchor VARCHAR(190)
        GENERATED ALWAYS AS (CASE WHEN archived_at IS NULL THEN anchor ELSE NULL END) STORED;

ALTER TABLE webinar_slides
    ADD UNIQUE KEY uq_webinar_slide_active_anchor (webinar_id, active_anchor);

ALTER TABLE webinar_slides
    DROP INDEX uq_webinar_slide_anchor;
