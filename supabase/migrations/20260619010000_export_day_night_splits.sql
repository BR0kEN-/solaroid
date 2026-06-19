alter table public.days
add column if not exists export_day numeric,
add column if not exists export_night numeric;

alter table public.months
add column if not exists export_day numeric,
add column if not exists export_night numeric;

alter table public.month_tariffs
add column if not exists price_export_day numeric,
add column if not exists price_export_night numeric;

update public.days
set export_day = export,
    export_night = 0
where export_day is null
   or export_night is null;

update public.months
set export_day = export,
    export_night = 0
where export_day is null
   or export_night is null;

update public.month_tariffs
set price_export_day = price_export,
    price_export_night = price_export
where price_export_day is null
   or price_export_night is null;

alter table public.days
alter column export_day set not null,
alter column export_night set not null;

alter table public.months
alter column export_day set not null,
alter column export_night set not null;

alter table public.month_tariffs
alter column price_export_day set not null,
alter column price_export_night set not null;

alter table public.days
drop column if exists export;

alter table public.months
drop column if exists export;

alter table public.month_tariffs
drop column if exists price_export;
