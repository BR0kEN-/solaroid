do $$
begin
  if exists (
    select 1
    from public.plants plant
    where not exists (
      select 1
      from public.plant_pv_changes pv_change
      where pv_change.plant_id = plant.id
        and pv_change.type = 'commissioning'
        and pv_change.date = plant.launch_date
    )
  ) then
    raise exception 'Every plant requires a commissioning event before dropping legacy PV metadata';
  end if;
end;
$$;

alter table public.plants
  drop column if exists domain,
  drop column if exists metadata;
