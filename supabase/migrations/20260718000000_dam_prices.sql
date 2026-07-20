create table public.dam_prices (
  date date primary key,
  updated_at timestamptz not null default now(),
  hour1 float8 not null,
  hour2 float8 not null,
  hour3 float8 not null,
  hour4 float8 not null,
  hour5 float8 not null,
  hour6 float8 not null,
  hour7 float8 not null,
  hour8 float8 not null,
  hour9 float8 not null,
  hour10 float8 not null,
  hour11 float8 not null,
  hour12 float8 not null,
  hour13 float8 not null,
  hour14 float8 not null,
  hour15 float8 not null,
  hour16 float8 not null,
  hour17 float8 not null,
  hour18 float8 not null,
  hour19 float8 not null,
  hour20 float8 not null,
  hour21 float8 not null,
  hour22 float8 not null,
  hour23 float8 not null,
  hour24 float8 not null
);

create trigger dam_prices_set_updated_at
before update on public.dam_prices
for each row
execute function public.set_updated_at();

alter table public.dam_prices enable row level security;
