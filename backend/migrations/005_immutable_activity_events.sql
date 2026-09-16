-- Audit events are append-only. Normal application requests have no update/delete route.
CREATE OR REPLACE FUNCTION prevent_activity_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'activity_events is append-only';
END;
$$;

DROP TRIGGER IF EXISTS activity_events_immutable_trigger ON activity_events;
CREATE TRIGGER activity_events_immutable_trigger
BEFORE UPDATE OR DELETE ON activity_events
FOR EACH ROW EXECUTE FUNCTION prevent_activity_event_mutation();
