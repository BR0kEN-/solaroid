alter table public.plants
add column if not exists metadata jsonb not null default '{}'::jsonb;
