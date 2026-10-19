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
