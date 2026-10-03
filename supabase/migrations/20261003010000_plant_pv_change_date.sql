alter table public.plant_pv_changes
  add column date date;

update public.plant_pv_changes changes
set date = spendings.date
from public.plant_spendings spendings
where spendings.id = changes.spending_id;

alter table public.plant_pv_changes
  alter column date set not null;
