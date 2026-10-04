alter table public.plant_pv_changes
  drop constraint plant_pv_changes_type_check,
  add constraint plant_pv_changes_type_check
    check (type in ('commissioning', 'improvement', 'damage_replacement'));

create unique index plant_pv_changes_one_commissioning_idx
  on public.plant_pv_changes (plant_id)
  where type = 'commissioning';

create or replace function public.validate_plant_pv_change_spending()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.type = 'commissioning' and new.spending_id is not null then
    raise exception 'Commissioning PV events cannot link to spending';
  end if;

  if new.type = 'commissioning' and not exists (
    select 1
    from public.plants
    where id = new.plant_id
      and launch_date = new.date
  ) then
    raise exception 'Commissioning PV event date must match plant launch date';
  end if;

  if new.spending_id is not null and not exists (
    select 1
    from public.plant_spendings
    where id = new.spending_id
      and plant_id = new.plant_id
      and type = new.type
  ) then
    raise exception 'Linked PV spending must match the event plant and type';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(new.operations) operation
    where coalesce(operation ->> 'kind', '') not in (
      'increase_field',
      'add_field',
      'decrease_field',
      'remove_field'
    )
  ) then
    raise exception 'PV change contains an unsupported operation';
  end if;

  if new.type = 'commissioning' and exists (
    select 1
    from jsonb_array_elements(new.operations) operation
    where coalesce(operation ->> 'kind', '') <> 'add_field'
  ) then
    raise exception 'Commissioning PV events may only add fields';
  end if;

  if new.type = 'improvement' and exists (
    select 1
    from jsonb_array_elements(new.operations) operation
    where coalesce(operation ->> 'kind', '') not in ('increase_field', 'add_field')
  ) then
    raise exception 'Improvement PV changes may only increase capacity';
  end if;

  return new;
end;
$$;
