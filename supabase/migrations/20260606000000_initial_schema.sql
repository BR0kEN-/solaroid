create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.plants (
  id text primary key,
  domain text unique not null,
  metadata jsonb not null default '{}'::jsonb,
  investment_usd numeric not null,
  launch_date date not null,
  commercial_date date not null,
  electric_heating_import_threshold_kwh numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.days (
  plant_id text not null references public.plants(id) on delete cascade,
  date date not null,
  production numeric not null,
  export numeric not null,
  import_day numeric not null,
  import_night numeric not null,
  consumption_day numeric not null,
  consumption_night numeric not null,
  uah_usd_rate numeric not null,
  uah_eur_rate numeric not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (plant_id, date)
);

create table public.months (
  plant_id text not null references public.plants(id) on delete cascade,
  date date not null,
  production numeric not null,
  export numeric not null,
  import_day numeric not null,
  import_night numeric not null,
  consumption_day numeric not null,
  consumption_night numeric not null,
  uah_usd_rate numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (plant_id, date),
  constraint months_date_is_month_start check (date = date_trunc('month', date)::date)
);

create table public.month_tariffs (
  plant_id text not null references public.plants(id) on delete cascade,
  date date not null,
  price_import_day numeric not null,
  price_import_night numeric not null,
  price_export numeric not null,
  export_taxes jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (plant_id, date),
  constraint month_tariffs_date_is_month_start check (date = date_trunc('month', date)::date)
);

create trigger plants_set_updated_at
before update on public.plants
for each row
execute function public.set_updated_at();

create trigger days_set_updated_at
before update on public.days
for each row
execute function public.set_updated_at();

create trigger months_set_updated_at
before update on public.months
for each row
execute function public.set_updated_at();

create trigger month_tariffs_set_updated_at
before update on public.month_tariffs
for each row
execute function public.set_updated_at();

alter table public.plants enable row level security;
alter table public.days enable row level security;
alter table public.months enable row level security;
alter table public.month_tariffs enable row level security;
