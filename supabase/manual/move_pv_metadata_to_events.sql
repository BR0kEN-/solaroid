-- Run after 20261004010000_pv_commissioning_events.sql and before deploying
-- the Edge Function that requires commissioning events.
begin;

do $$
declare
  plant record;
  pv_event record;
  operation record;
  fields jsonb;
  field_value jsonb;
  field_index integer;
  field_id text;
  modules integer;
  power numeric;
  commissioning_operations jsonb;
begin
  for plant in
    select id, launch_date, metadata
    from public.plants
    where metadata ? 'pvs'
    order by id
  loop
    if exists (
      select 1
      from public.plant_pv_changes
      where plant_id = plant.id
        and type = 'commissioning'
    ) then
      raise exception 'Plant % already has a commissioning event', plant.id;
    end if;

    fields := plant.metadata -> 'pvs';
    if fields is null or jsonb_typeof(fields) <> 'array' or jsonb_array_length(fields) = 0 then
      raise exception 'Plant % has no PV fields to migrate', plant.id;
    end if;

    if exists (
      select 1
      from jsonb_array_elements(fields) field
      where coalesce(field ->> 'id', '') = ''
        or (field ->> 'modules') is null
        or (field ->> 'power') is null
        or (field ->> 'modules')::integer <= 0
        or (field ->> 'power')::numeric <= 0
    ) then
      raise exception 'Plant % PV fields require id, modules, and power', plant.id;
    end if;

    if (
      select count(*) <> count(distinct field ->> 'id')
      from jsonb_array_elements(fields) field
    ) then
      raise exception 'Plant % has duplicate PV field IDs', plant.id;
    end if;

    for pv_event in
      select id, operations
      from public.plant_pv_changes
      where plant_id = plant.id
        and type = 'improvement'
      order by date desc, id desc
    loop
      for operation in
        select value, ordinality
        from jsonb_array_elements(pv_event.operations) with ordinality
        order by ordinality desc
      loop
        if operation.value ->> 'kind' = 'increase_field' then
          field_id := operation.value ->> 'field_id';
          field_value := null;
          field_index := null;

          select (item.ordinality - 1)::integer, item.value
          into field_index, field_value
          from jsonb_array_elements(fields) with ordinality item(value, ordinality)
          where item.value ->> 'id' = field_id;

          if field_value is null then
            raise exception 'Improvement event % references missing field %', pv_event.id, field_id;
          end if;

          modules := (field_value ->> 'modules')::integer
            - (operation.value ->> 'modules_added')::integer;
          power := (field_value ->> 'power')::numeric
            - (operation.value ->> 'power_added_w')::numeric;

          if modules <= 0 or power <= 0 then
            raise exception 'Improvement event % produces invalid launch field %', pv_event.id, field_id;
          end if;

          field_value := field_value || jsonb_build_object(
            'modules', modules,
            'power', power
          );
          fields := jsonb_set(fields, array[field_index::text], field_value, false);
        elsif operation.value ->> 'kind' = 'add_field' then
          field_id := operation.value #>> '{field,id}';
          field_value := null;

          select item.value
          into field_value
          from jsonb_array_elements(fields) item(value)
          where item.value ->> 'id' = field_id;

          if field_value is null then
            raise exception 'Improvement event % added field % missing from metadata', pv_event.id, field_id;
          end if;

          if field_value <> (operation.value -> 'field') then
            raise exception 'Improvement event % added field % does not match metadata', pv_event.id, field_id;
          end if;

          select coalesce(jsonb_agg(item.value order by item.ordinality), '[]'::jsonb)
          into fields
          from jsonb_array_elements(fields) with ordinality item(value, ordinality)
          where item.value ->> 'id' <> field_id;
        else
          raise exception 'Improvement event % contains unsupported operation %',
            pv_event.id,
            operation.value ->> 'kind';
        end if;
      end loop;
    end loop;

    if jsonb_array_length(fields) = 0 then
      raise exception 'Plant % reconstructed launch configuration is empty', plant.id;
    end if;

    select jsonb_agg(
      jsonb_build_object('kind', 'add_field', 'field', item.value)
      order by item.ordinality
    )
    into commissioning_operations
    from jsonb_array_elements(fields) with ordinality item(value, ordinality);

    insert into public.plant_pv_changes (
      plant_id,
      date,
      type,
      spending_id,
      operations
    ) values (
      plant.id,
      plant.launch_date,
      'commissioning',
      null,
      commissioning_operations
    );
  end loop;
end;
$$;

do $$
begin
  if exists (
    select 1
    from public.plants plant
    where not exists (
        select 1
        from public.plant_pv_changes pv_event
        where pv_event.plant_id = plant.id
          and pv_event.type = 'commissioning'
          and pv_event.date = plant.launch_date
      )
  ) then
    raise exception 'Not every PV metadata record has a commissioning event';
  end if;
end;
$$;

update public.plants
set metadata = metadata - 'pvs'
where metadata ? 'pvs';

commit;
