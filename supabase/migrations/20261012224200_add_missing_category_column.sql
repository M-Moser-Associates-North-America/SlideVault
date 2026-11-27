-- category was referenced in application code and discussed as part of the team's slide
-- record, but was never actually added to the decks table in either prior migration --
-- caught by testing the upload endpoint live against the real database, not by review.
alter table decks add column category text;
notify pgrst, 'reload schema';
