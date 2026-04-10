-- Migration 054: Add Processing, News, Pricing, Info tag categories
-- Date: 2026-04-10

INSERT IGNORE INTO investor_tags (name, color) VALUES
    ('Processing', '#e74c3c'),
    ('News', '#3498db'),
    ('Pricing', '#f39c12'),
    ('Info', '#1abc9c');
