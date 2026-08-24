CREATE OR REPLACE FUNCTION reject_calendar_booking_history_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'CALENDAR_BOOKING_HISTORY_IMMUTABLE';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER calendar_booking_history_immutable_update
BEFORE UPDATE ON calendar_booking_history
FOR EACH ROW EXECUTE FUNCTION reject_calendar_booking_history_update();
