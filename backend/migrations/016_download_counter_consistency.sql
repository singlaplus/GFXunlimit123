UPDATE images AS i
SET downloads = counts.total
FROM (
  SELECT i2.id, COUNT(d.id)::INTEGER AS total
  FROM images i2
  LEFT JOIN downloads d ON d.image_id = i2.id
  GROUP BY i2.id
) AS counts
WHERE i.id = counts.id;

CREATE OR REPLACE FUNCTION sync_image_download_counter()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE images
  SET downloads = COALESCE(downloads, 0) + 1
  WHERE id = NEW.image_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS downloads_sync_image_counter ON downloads;

CREATE TRIGGER downloads_sync_image_counter
AFTER INSERT ON downloads
FOR EACH ROW
EXECUTE FUNCTION sync_image_download_counter();
