create extension if not exists pgcrypto with schema extensions;

create table public.access_tokens (
  id uuid primary key default extensions.gen_random_uuid(),
  plant_id text not null references public.plants(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now()
);

create table public.access_token_read_scopes (
  token_id uuid not null references public.access_tokens(id) on delete cascade,
  plant_id text not null references public.plants(id) on delete cascade,
  scopes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  primary key (token_id, plant_id)
);

alter table public.access_tokens enable row level security;
alter table public.access_token_read_scopes enable row level security;
