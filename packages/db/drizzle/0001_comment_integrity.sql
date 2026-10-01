-- Comments are max depth 1 and a reply must live on the same post as its parent.
-- (CHECK constraints cannot look at other rows, so this is a trigger.)
CREATE OR REPLACE FUNCTION comment_enforce_depth() RETURNS trigger AS $$
DECLARE
  parent_row record;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT post_id, parent_id INTO parent_row FROM comment WHERE id = NEW.parent_id;
  IF NOT FOUND THEN
    RETURN NEW; -- the foreign key reports the missing parent
  END IF;
  IF parent_row.parent_id IS NOT NULL THEN
    RAISE EXCEPTION 'comment replies are limited to one level' USING ERRCODE = 'check_violation', CONSTRAINT = 'comment_max_depth';
  END IF;
  IF parent_row.post_id <> NEW.post_id THEN
    RAISE EXCEPTION 'reply must belong to the same post as its parent' USING ERRCODE = 'check_violation', CONSTRAINT = 'comment_same_post';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER comment_enforce_depth
  BEFORE INSERT OR UPDATE OF parent_id, post_id ON comment
  FOR EACH ROW EXECUTE FUNCTION comment_enforce_depth();
