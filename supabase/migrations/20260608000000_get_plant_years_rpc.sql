create or replace function public.get_plant_years(p_plant_id text)
returns table(year text)
language sql
stable
as $$
  select distinct extract(year from date) as year
  from public.months
  where plant_id = p_plant_id
  order by year desc;
$$;
