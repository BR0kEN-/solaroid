insert into storage.buckets (id, name, public)
values ('month-docs', 'month-docs', false)
on conflict (id) do nothing;

create or replace function public.month_docs(plant_id text, month text)
returns table (
  id uuid,
  name text,
  created_at timestamptz,
  updated_at timestamptz,
  last_accessed_at timestamptz,
  metadata jsonb,
  user_metadata jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
begin
return query
select
  so.id,
  so.name,
  so.created_at,
  so.updated_at,
  so.last_accessed_at,
  so.metadata,
  so.user_metadata
from
  storage.objects as so
where
  so.bucket_id = 'month-docs'
  and (so.user_metadata->>'plantId') = plant_id
  and (so.user_metadata->>'month') = month;
end;
$$;
