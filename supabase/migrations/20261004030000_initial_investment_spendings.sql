alter table public.plant_spendings
  drop constraint plant_spendings_type_check,
  add constraint plant_spendings_type_check
    check (type in ('initial', 'damage_replacement', 'improvement'));

insert into public.plant_spendings (plant_id, date, type, amount_usd)
select id, launch_date, 'initial', investment_usd
from public.plants
where investment_usd > 0;

alter table public.plants
  drop column investment_usd;
