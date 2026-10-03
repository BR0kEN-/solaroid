create table public.plant_pv_changes (
  spending_id bigint primary key references public.plant_spendings(id) on delete cascade,
  operations jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plant_pv_changes_operations_check check (
    jsonb_typeof(operations) = 'array' and jsonb_array_length(operations) > 0
  )
);

create or replace function public.validate_plant_pv_change_spending()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.plant_spendings
    where id = new.spending_id
      and type = 'improvement'
  ) then
    raise exception 'PV changes require an improvement spending';
  end if;

  return new;
end;
$$;

create trigger plant_pv_changes_validate_spending
before insert or update on public.plant_pv_changes
for each row
execute function public.validate_plant_pv_change_spending();

create or replace function public.prevent_non_improvement_pv_change_spending()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.type <> 'improvement' and exists (
    select 1
    from public.plant_pv_changes
    where spending_id = new.id
  ) then
    raise exception 'A spending linked to PV changes must remain an improvement';
  end if;

  return new;
end;
$$;

create trigger plant_spendings_preserve_pv_change_type
before update of type on public.plant_spendings
for each row
execute function public.prevent_non_improvement_pv_change_spending();

create trigger plant_pv_changes_set_updated_at
before update on public.plant_pv_changes
for each row
execute function public.set_updated_at();

alter table public.plant_pv_changes enable row level security;
