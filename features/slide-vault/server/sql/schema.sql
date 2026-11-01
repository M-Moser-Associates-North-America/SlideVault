-- SlideVault tables for M Moser's Supabase project (docs/DECISIONS.md FD-12).
--
-- Runs inside our own schema: the connection sets search_path, so nothing here names a
-- schema. Safe to run more than once (everything is "if not exists").
--
-- Same columns as supabase/migrations (the team's slide record, docs/foundry/SLIDE_RECORD.md),
-- folded into one file. Plain text with check rules instead of custom enum types, so the shared
-- developer role can own everything without extra grants. Storage buckets are managed by
-- M Moser, so this file creates no buckets.

create table if not exists decks (
  id uuid primary key default gen_random_uuid(),
  client text not null,
  year integer,
  category text,
  title text not null,
  source_path text not null,
  source_filename text not null,
  file_path text not null unique,
  file_hash text not null unique,
  source text not null default 'upload' check (source in ('upload', 'sharepoint')),
  best_of_the_best boolean not null default false,
  slide_count integer not null default 0,
  slide_size text,
  status text not null default 'queued' check (status in ('queued', 'processing', 'ready', 'failed')),
  error text,
  uploaded_at timestamptz not null default now()
);

create table if not exists slides (
  id uuid primary key default gen_random_uuid(),
  deck_id uuid not null references decks (id) on delete cascade,
  slide_number integer not null,
  title text,
  text text,
  notes text,
  search_text tsvector generated always as (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(text, ''))
  ) stored,
  thumbnail_path text,
  is_hidden_in_source boolean not null default false,
  slide_type text,
  description text,
  sector text,
  tag_status text check (tag_status in ('suggested', 'approved')),
  created_at timestamptz not null default now(),
  unique (deck_id, slide_number)
);

create index if not exists slides_search_text_idx on slides using gin (search_text);
create index if not exists slides_deck_id_idx on slides (deck_id);
create index if not exists decks_status_idx on decks (status);

-- Per-person data and real usage counts (docs/DECISIONS.md FD-18). slide_id is text, not a
-- foreign key, because sample-library slides have ids that aren't in the slides table.

-- "Most downloaded": one running total per slide. No names, so it needs no opt-in.
create table if not exists slide_downloads (
  slide_id text primary key,
  downloads integer not null default 0,
  last_downloaded_at timestamptz not null default now()
);

-- Saved slides, per person.
create table if not exists saved_slides (
  user_key text not null,
  slide_id text not null,
  saved_at timestamptz not null default now(),
  primary key (user_key, slide_id)
);

-- My decks: named, ordered sets of slides, per person.
create table if not exists drafts (
  id uuid primary key default gen_random_uuid(),
  user_key text not null,
  name text not null,
  slide_ids text[] not null default '{}',
  saved_at timestamptz not null default now()
);
create index if not exists drafts_user_idx on drafts (user_key, saved_at desc);

-- Each person's choices. Activity tracking is off until they turn it on.
create table if not exists user_settings (
  user_key text primary key,
  activity_opt_in boolean not null default false,
  updated_at timestamptz not null default now()
);

-- What a person opened, saved or downloaded, only while they've opted in. Used only to rank their
-- own Top 10 and Suggested rows. Rows older than 90 days are deleted; opting out deletes them all.
create table if not exists activity_events (
  id bigint generated always as identity primary key,
  user_key text not null,
  kind text not null check (kind in ('viewed', 'saved', 'downloaded')),
  slide_id text,
  label text not null default '',
  at timestamptz not null default now()
);
create index if not exists activity_user_at_idx on activity_events (user_key, at desc);
create index if not exists activity_at_idx on activity_events (at);

-- "Was this helpful?" on storyboards (docs/DECISIONS.md FD-24): which slides really do each part of
-- a story, for which kinds of brief. No person and never the brief, only its topic words, so it
-- needs no opt-in and helps everyone's next storyboard.
create table if not exists story_feedback (
  id bigint generated always as identity primary key,
  role text not null check (role in ('client-challenge', 'insight', 'strategy', 'experience', 'why-us', 'outcome')),
  slide_id text,
  verdict text not null check (verdict in ('useful', 'not-right', 'nothing-fits')),
  topics text[] not null default '{}',
  at timestamptz not null default now()
);
create index if not exists story_feedback_slide_idx on story_feedback (slide_id);
-- Who gave the verdict, by role only (FD-25): business-developer, director or bd-support.
alter table story_feedback add column if not exists by_role text;

-- Useful / Not relevant on a search result (docs/DECISIONS.md FD-59): the slide, the verdict and the
-- search's words, never the search itself or a name. Only from people who opted in (FD-37).
create table if not exists search_feedback (
  id bigint generated always as identity primary key,
  slide_id text not null,
  verdict text not null check (verdict in ('useful', 'not-relevant')),
  words text[] not null default '{}',
  by_role text,
  at timestamptz not null default now()
);
create index if not exists search_feedback_slide_idx on search_feedback (slide_id);

-- Archived decks (docs/DECISIONS.md FD-50): hidden from the app, search and AI without deleting
-- anything (the bucket can't delete). Set by scripts/archive-deck.mts for now; archive in the app
-- (Khushali's archive and delete work) builds on this same column.
alter table decks add column if not exists archived_at timestamptz;

-- ---------------------------------------------------------------------------------------------
-- Story data (docs/DECISIONS.md FD-51): what each slide does in a proposal, slide packs and
-- free-form tags. Filled by scripts/import-story-data.mts from the team's reviewed metadata and
-- the AI's reading of each slide, and later at upload. Alina's rule: anything the AI suggested
-- stays "suggested" until a person confirms it.
--
-- Deck details from the SharePoint-style view (author, office, uploaded by, dates) are Khushali's
-- and go in their own block, so the two don't collide. project_location below is where the
-- client's project is (New York, Vancouver), not the M Moser office that made the deck.

alter table decks add column if not exists deck_kind text;          -- e.g. "RFP - HQ fit-out", "Resume appendix"
alter table decks add column if not exists client_sector text;      -- e.g. "financial services"
alter table decks add column if not exists project_location text;   -- e.g. "New York", "Global"
alter table decks add column if not exists outcome text check (outcome in ('won', 'lost', 'pending'));

alter table slides add column if not exists story_role text;        -- client challenge, insight, approach, proof, why us, outcome, intro, admin, divider
alter table slides add column if not exists reuse_status text;      -- reusable, reusable - check currency, client-specific - reference only, internal - never show
alter table slides add column if not exists image_kind text;        -- e.g. built project photography, headshots, plan / diagram
alter table slides add column if not exists themes text[] not null default '{}';         -- e.g. sustainability / net zero
alter table slides add column if not exists proof_sectors text[] not null default '{}';  -- sectors a case study proves experience in
alter table slides add column if not exists projects text[] not null default '{}';       -- projects a case study shows
alter table slides add column if not exists flags text[] not null default '{}';          -- e.g. names another client / leftover placeholder
alter table slides add column if not exists shows text;             -- one line: what the slide shows
alter table slides add column if not exists convinces text;         -- one line: what it convinces the client of
alter table slides add column if not exists story_status text check (story_status in ('suggested', 'confirmed'));
alter table slides add column if not exists story_confirmed_by text;
alter table slides add column if not exists ai_uncertain boolean not null default false; -- the AI's second reading disagreed with its first

-- Slide packs: slides that only work together (Grant, 21 Oct). Suggested at upload or import,
-- confirmed by the person uploading. Picking one slide brings the rest, in order.
create table if not exists slide_packs (
  id uuid primary key default gen_random_uuid(),
  deck_id uuid not null references decks (id) on delete cascade,
  label text,
  status text not null default 'suggested' check (status in ('suggested', 'confirmed')),
  source text not null default 'import' check (source in ('import', 'upload', 'person')),
  created_at timestamptz not null default now()
);
create table if not exists slide_pack_members (
  pack_id uuid not null references slide_packs (id) on delete cascade,
  slide_id uuid not null references slides (id) on delete cascade,
  position integer not null,
  primary key (pack_id, slide_id)
);
create index if not exists slide_pack_members_slide_idx on slide_pack_members (slide_id);
create index if not exists slide_packs_deck_idx on slide_packs (deck_id);

-- Free-form tags anyone can add to a deck or slide (Alina, 21 Oct), kept apart from the AI's.
create table if not exists free_tags (
  id bigint generated always as identity primary key,
  target_kind text not null check (target_kind in ('deck', 'slide')),
  target_id uuid not null,
  tag text not null check (length(trim(tag)) between 1 and 60),
  added_by text not null,
  added_at timestamptz not null default now()
);
create unique index if not exists free_tags_one_per_target on free_tags (target_kind, target_id, lower(tag));
create index if not exists free_tags_tag_idx on free_tags (lower(tag));
-- Removing a tag keeps it, with who removed it and when (FD-72, 1 Nov): the slide page can say so,
-- and Undo or Restore brings it back with its original adder. Live tags are the ones not removed.
alter table free_tags add column if not exists removed_by text;
alter table free_tags add column if not exists removed_at timestamptz;

-- Renaming a slide for everyone (FD-73, 1 Nov): the title read from the slide is kept, with who renamed
-- it and when, so the slide page can say so and the rename can be undone.
alter table slides add column if not exists original_title text;
alter table slides add column if not exists title_edited_by text;
alter table slides add column if not exists title_edited_at timestamptz;
create index if not exists slides_story_role_idx on slides (story_role);

-- ---------------------------------------------------------------------------------------------
-- Packs, archive and deck details served to the app (docs/DECISIONS.md FD-52).
-- Packs can be confirmed, unconfirmed or dismissed, with who and when. A dismissed suggestion is
-- kept (not deleted) so neither the import nor the storyboard suggests it again.
alter table slide_packs drop constraint if exists slide_packs_status_check;
alter table slide_packs add constraint slide_packs_status_check check (status in ('suggested', 'confirmed', 'dismissed'));
alter table slide_packs add column if not exists created_by text;
alter table slide_packs add column if not exists updated_at timestamptz not null default now();
alter table slide_packs add column if not exists confirmed_by text;
alter table slide_packs add column if not exists confirmed_at timestamptz;
alter table slide_packs add column if not exists dismissed_by text;
alter table slide_packs add column if not exists dismissed_at timestamptz;

-- Who archived a deck (archived_at above says when).
alter table decks add column if not exists archived_by text;

-- Deck details for the SharePoint-style view and the Created by / Uploaded by filters. Real values
-- only: created_by and file_created_at are what PowerPoint itself recorded in the file
-- (docProps/core.xml); uploaded_by is the signed-in person who uploaded it.
alter table decks add column if not exists created_by text;
alter table decks add column if not exists file_created_at timestamptz;
alter table decks add column if not exists uploaded_by text;

-- Each person's role, chosen in their profile (docs/DECISIONS.md FD-71): business developer, director or
-- BD support (Grant's three groups, 21 Oct). Kept on the server so Suggested for you can be role-based
-- (Gaby, 28 Oct): counts of what people in a role use, never names. Null until someone picks one.
alter table user_settings add column if not exists role text check (role in ('business-developer', 'director', 'bd-support'));
