alter table public.plants
add column if not exists domain text;

create unique index if not exists plants_domain_unique
on public.plants (domain)
where domain is not null;

create table public.user_plant_access (
  user_id uuid not null references auth.users(id) on delete cascade,
  plant_id text not null references public.plants(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, plant_id)
);

alter table public.user_plant_access enable row level security;
