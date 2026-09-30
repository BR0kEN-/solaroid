alter table public.plant_spendings
drop constraint plant_spendings_type_check;

alter table public.plant_spendings
add constraint plant_spendings_type_check
check (type in ('damage_replacement', 'improvement'));
