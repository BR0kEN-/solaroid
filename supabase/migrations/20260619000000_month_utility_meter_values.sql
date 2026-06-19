alter table public.months
add column if not exists utility_import_day numeric,
add column if not exists utility_import_night numeric,
add column if not exists utility_export_day numeric,
add column if not exists utility_export_night numeric;
