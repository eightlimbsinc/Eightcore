-- Hand-written: updated_at maintenance for comments.
CREATE TRIGGER comments_set_updated_at BEFORE UPDATE ON comments
  FOR EACH ROW EXECUTE FUNCTION eightcore_set_updated_at();
