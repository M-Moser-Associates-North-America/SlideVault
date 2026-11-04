-- SlideVault v1 schema, scoped to the Oct 2026 recap: decks/slides vocabulary,
-- keyword search now, AI-assisted search/embeddings added once a provider is
-- confirmed (open question D-12), content-type label suggestions with human
-- approval, and a simple ordered selection for slide download.
--
-- RLS is enabled with no policies yet: everything is deny-by-default until the
-- access model (open question D-02) is resolved. The server uses the Supabase
-- service role, which bypasses RLS, so authorization is enforced in
-- application code until real policies are written.

create extension if not exists pgcrypto;

create type deck_status as enum ('queued', 'processing', 'ready', 'failed');
create type label_source as enum ('ai', 'human');
create type label_status as enum ('suggested', 'approved', 'rejected');

create table decks (
  id uuid primary key default gen_random_uuid(),
  client_name text not null,
  deck_year integer,
  title text not null,
  folder_path text not null,
  source_filename text not null,
  source_storage_key text not null unique,
  file_sha256 text not null unique,
  status deck_status not null default 'queued',
  status_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table slides (
  id uuid primary key default gen_random_uuid(),
  deck_id uuid not null references decks (id) on delete cascade,
  slide_number integer not null,
  title text,
  extracted_text text,
  search_text tsvector generated always as (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(extracted_text, ''))
  ) stored,
  preview_storage_key text,
  aspect_ratio text,
  is_hidden_in_source boolean not null default false,
  created_at timestamptz not null default now(),
  unique (deck_id, slide_number)
);

create index slides_search_text_idx on slides using gin (search_text);
create index slides_deck_id_idx on slides (deck_id);

-- Content-type labels (About us / Values / Case study / Team, etc.). The real
-- list is one of the open questions sent to Alina on Oct 8 -- seeded below
-- with her team's own examples as placeholders, not a confirmed taxonomy.
create table labels (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  created_at timestamptz not null default now()
);

create table slide_labels (
  id uuid primary key default gen_random_uuid(),
  slide_id uuid not null references slides (id) on delete cascade,
  label_id uuid not null references labels (id) on delete cascade,
  source label_source not null,
  status label_status not null default 'suggested',
  suggested_reason text,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (slide_id, label_id)
);

create index slide_labels_slide_id_idx on slide_labels (slide_id);
create index slide_labels_status_idx on slide_labels (status);

-- A user's ordered set of slides queued for download.
create table selections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table selection_items (
  id uuid primary key default gen_random_uuid(),
  selection_id uuid not null references selections (id) on delete cascade,
  slide_id uuid not null references slides (id) on delete restrict,
  position integer not null,
  created_at timestamptz not null default now(),
  unique (selection_id, slide_id),
  unique (selection_id, position)
);

alter table decks enable row level security;
alter table slides enable row level security;
alter table labels enable row level security;
alter table slide_labels enable row level security;
alter table selections enable row level security;
alter table selection_items enable row level security;

insert into storage.buckets (id, name, public)
values
  ('slide-originals', 'slide-originals', false),
  ('slide-previews', 'slide-previews', false)
on conflict (id) do nothing;

insert into labels (name, description) values
  ('About us', 'Placeholder type -- pending the confirmed list from M Moser (open question, Oct 8 recap)'),
  ('Values', 'Placeholder type -- pending the confirmed list from M Moser (open question, Oct 8 recap)'),
  ('Case study', 'Placeholder type -- pending the confirmed list from M Moser (open question, Oct 8 recap)'),
  ('Team', 'Placeholder type -- pending the confirmed list from M Moser (open question, Oct 8 recap)')
on conflict (name) do nothing;
