-- Meaning search (docs/DECISIONS.md FD-55). Run by `npm run db:vector`, not by db:setup, because it
-- needs the pgvector extension, which only the project owner can switch on.
--
-- One "meaning fingerprint" (embedding) per slide, with the model that made it. The column has no
-- fixed size, so any embedding model works; search only compares fingerprints from the same model.
-- Switching models means running `npm run embed:slides` again: no table change.
create table if not exists slide_embeddings (
  slide_id uuid primary key references slides (id) on delete cascade,
  model text not null,
  embedding vector not null,
  -- What was read (title, text and story tags), so unchanged slides aren't sent again
  source_hash text not null,
  created_at timestamptz not null default now()
);
create index if not exists slide_embeddings_model_idx on slide_embeddings (model);
