alter table public.days
add column if not exists losses_day numeric not null default 0,
add column if not exists losses_night numeric not null default 0;

alter table public.months
add column if not exists losses_day numeric not null default 0,
add column if not exists losses_night numeric not null default 0;
