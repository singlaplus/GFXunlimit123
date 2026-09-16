ALTER TABLE downloads
  ADD COLUMN IF NOT EXISTS order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS downloads_order_asset_user_idx
  ON downloads (order_id, image_id, user_id)
  WHERE order_id IS NOT NULL;

INSERT INTO downloads (user_id, image_id, downloaded_at, order_id)
SELECT cd.user_id, cd.image_id, COALESCE(o.updated_at, o.created_at, NOW()), o.id
FROM customer_downloads cd
JOIN orders o ON o.id = cd.order_id
WHERE o.order_status IN ('completed', 'paid')
  AND cd.is_active IS NOT FALSE
  AND NOT EXISTS (
    SELECT 1
    FROM downloads d
    WHERE d.user_id = cd.user_id
      AND d.image_id = cd.image_id
      AND d.downloaded_at >= o.created_at
  )
ON CONFLICT DO NOTHING;