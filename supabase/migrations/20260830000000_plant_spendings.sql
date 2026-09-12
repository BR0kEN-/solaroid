create table public.plant_spendings (
  id bigint generated always as identity primary key,
  plant_id text not null references public.plants(id) on delete cascade,
  date date not null,
  type text not null,
  amount_usd numeric not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plant_spendings_type_check check (type = 'damage_replacement'),
  constraint plant_spendings_amount_usd_check check (amount_usd > 0)
);

create index plant_spendings_plant_date_id_idx
on public.plant_spendings (plant_id, date, id);

create trigger plant_spendings_set_updated_at
before update on public.plant_spendings
for each row
execute function public.set_updated_at();

alter table public.plant_spendings enable row level security;
