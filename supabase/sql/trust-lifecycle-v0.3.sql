-- Trust Spine lifecycle persistence v0.3
-- Server-side replay/supersession state with atomic compare-and-swap semantics.
-- No secret values are stored in source control.

create schema if not exists henyong_internal;

create table if not exists henyong_internal.lifecycle_registry (
  context_id text primary key,
  revision bigint not null check (revision >= 1),
  registry jsonb not null check (jsonb_typeof(registry) = 'object'),
  updated_at timestamptz not null default now(),
  check (length(btrim(context_id)) between 1 and 200)
);

revoke all on table henyong_internal.lifecycle_registry from public;
revoke all on table henyong_internal.lifecycle_registry from anon;
revoke all on table henyong_internal.lifecycle_registry from authenticated;

-- Service-role-only read boundary. The internal table is not exposed directly.
create or replace function public.henyong_lifecycle_registry_load(p_context_id text)
returns table (
  context_id text,
  revision bigint,
  registry jsonb
)
language sql
security definer
set search_path = 'henyong_internal', 'pg_catalog'
as $$
  select lr.context_id, lr.revision, lr.registry
  from henyong_internal.lifecycle_registry as lr
  where lr.context_id = p_context_id;
$$;

revoke all on function public.henyong_lifecycle_registry_load(text) from public;
revoke all on function public.henyong_lifecycle_registry_load(text) from anon;
revoke all on function public.henyong_lifecycle_registry_load(text) from authenticated;
grant execute on function public.henyong_lifecycle_registry_load(text) to service_role;

-- Atomic compare-and-swap write boundary.
-- NULL expected revision means "insert only if absent".
-- Non-NULL expected revision means "update only if current revision matches".
create or replace function public.henyong_lifecycle_registry_cas(
  p_context_id text,
  p_expected_revision bigint,
  p_next_revision bigint,
  p_registry jsonb
)
returns boolean
language plpgsql
security definer
set search_path = 'henyong_internal', 'pg_catalog'
as $$
declare
  affected_rows integer := 0;
begin
  if p_context_id is null
     or length(btrim(p_context_id)) < 1
     or length(btrim(p_context_id)) > 200 then
    raise exception 'invalid_context_id';
  end if;

  if p_next_revision is null or p_next_revision < 1 then
    raise exception 'invalid_next_revision';
  end if;

  if p_registry is null or jsonb_typeof(p_registry) <> 'object' then
    raise exception 'invalid_registry_payload';
  end if;

  if p_expected_revision is null then
    if p_next_revision <> 1 then
      raise exception 'initial_revision_must_be_one';
    end if;

    insert into henyong_internal.lifecycle_registry (
      context_id,
      revision,
      registry,
      updated_at
    )
    values (
      p_context_id,
      p_next_revision,
      p_registry,
      now()
    )
    on conflict (context_id) do nothing;

    get diagnostics affected_rows = row_count;
    return affected_rows = 1;
  end if;

  if p_expected_revision < 1 then
    raise exception 'invalid_expected_revision';
  end if;

  if p_next_revision <> p_expected_revision + 1 then
    raise exception 'revision_must_increment_by_one';
  end if;

  update henyong_internal.lifecycle_registry
  set revision = p_next_revision,
      registry = p_registry,
      updated_at = now()
  where context_id = p_context_id
    and revision = p_expected_revision;

  get diagnostics affected_rows = row_count;
  return affected_rows = 1;
end;
$$;

revoke all on function public.henyong_lifecycle_registry_cas(text, bigint, bigint, jsonb) from public;
revoke all on function public.henyong_lifecycle_registry_cas(text, bigint, bigint, jsonb) from anon;
revoke all on function public.henyong_lifecycle_registry_cas(text, bigint, bigint, jsonb) from authenticated;
grant execute on function public.henyong_lifecycle_registry_cas(text, bigint, bigint, jsonb) to service_role;
