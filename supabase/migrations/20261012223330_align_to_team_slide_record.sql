-- Aligns the schema to the team's signed-off slide record (docs/foundry/SLIDE_RECORD.md,
-- updated 2026-10-12): exact field names agreed by Lola/Vincent/Khushali so the database,
-- the worker, and the screens all use the same vocabulary. No real data exists yet (only
-- the four placeholder label rows), so these renames are free.
--
-- One deliberate addition beyond the team's list, flagged at the time it was proposed:
-- slides.is_hidden_in_source is kept. It wasn't in the agreed field list, but it's a
-- feature that already works and was tested (the "Hidden in source" badge in both the
-- rebuild and Sean's POC) -- dropping it would have been a silent regression, not a
-- simplification.

create type deck_source_type as enum ('upload', 'sharepoint');
create type tag_status_type as enum ('suggested', 'approved');

alter table decks
  rename column client_name to client;
alter table decks
  rename column deck_year to year;
alter table decks
  rename column folder_path to source_path;
alter table decks
  rename column source_storage_key to file_path;
alter table decks
  rename column file_sha256 to file_hash;
alter table decks
  rename column status_detail to error;
alter table decks
  rename column created_at to uploaded_at;

alter table decks drop column updated_at;

alter table decks
  add column source deck_source_type not null default 'upload',
  add column best_of_the_best boolean not null default false,
  add column slide_count integer not null default 0,
  add column slide_size text;

alter table slides
  rename column extracted_text to text;
alter table slides
  rename column preview_storage_key to thumbnail_path;

alter table slides drop column aspect_ratio;

alter table slides
  add column notes text,
  add column slide_type text,
  add column description text,
  add column sector text,
  add column tag_status tag_status_type;

-- Superseded by slide_type/description/sector/tag_status directly on slides -- simpler
-- than the per-label join-table design, per the team's own proposal.
drop table if exists slide_labels;
drop table if exists labels;
drop type if exists label_source;
drop type if exists label_status;
