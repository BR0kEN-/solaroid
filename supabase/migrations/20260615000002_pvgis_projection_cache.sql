create table if not exists public.plant_pvgis_projections (
  plant_id text primary key references public.plants(id) on delete cascade,
  metadata_hash text not null,
  projection jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger plant_pvgis_projections_set_updated_at
before update on public.plant_pvgis_projections
for each row execute function public.set_updated_at();

alter table public.plant_pvgis_projections enable row level security;
