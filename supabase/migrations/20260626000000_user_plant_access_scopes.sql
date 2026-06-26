alter table public.access_token_read_scopes
add column if not exists scopes jsonb not null default '[]'::jsonb;

alter table public.user_plant_access
add column if not exists scopes jsonb not null default '[]'::jsonb;
