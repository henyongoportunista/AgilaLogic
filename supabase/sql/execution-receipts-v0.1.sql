-- Execution receipt persistence v0.1
-- Append-once evidence storage for identity-bound execution receipts.
-- Source contract only: no live project mutation is performed here.

create schema if not exists henyong_internal;

revoke all on schema henyong_internal from public;
revoke all on schema henyong_internal from anon;
revoke all on schema henyong_internal from authenticated;
grant usage on schema henyong_internal to service_role;

create table if not exists henyong_internal.execution_receipts (
  receipt_id text primary key,
  pre_execution_binding text not null unique,
  receipt jsonb not null check (jsonb_typeof(receipt) = 'object'),
  created_at timestamptz not null default now(),
  check (length(btrim(receipt_id)) between 1 and 200),
  check (length(btrim(pre_execution_binding)) between 1 and 100000)
);

revoke all on table henyong_internal.execution_receipts from public;
revoke all on table henyong_internal.execution_receipts from anon;
revoke all on table henyong_internal.execution_receipts from authenticated;
grant select, insert on table henyong_internal.execution_receipts to service_role;

create or replace function public.henyong_execution_receipt_load_by_id(p_receipt_id text)
returns table (receipt jsonb)
language sql
security definer
set search_path = 'henyong_internal', 'pg_catalog'
as $$
  select er.receipt
  from henyong_internal.execution_receipts as er
  where er.receipt_id = p_receipt_id;
$$;

revoke all on function public.henyong_execution_receipt_load_by_id(text) from public;
revoke all on function public.henyong_execution_receipt_load_by_id(text) from anon;
revoke all on function public.henyong_execution_receipt_load_by_id(text) from authenticated;
grant execute on function public.henyong_execution_receipt_load_by_id(text) to service_role;

create or replace function public.henyong_execution_receipt_load_by_pre_execution(
  p_pre_execution_binding text
)
returns table (receipt jsonb)
language sql
security definer
set search_path = 'henyong_internal', 'pg_catalog'
as $$
  select er.receipt
  from henyong_internal.execution_receipts as er
  where er.pre_execution_binding = p_pre_execution_binding;
$$;

revoke all on function public.henyong_execution_receipt_load_by_pre_execution(text) from public;
revoke all on function public.henyong_execution_receipt_load_by_pre_execution(text) from anon;
revoke all on function public.henyong_execution_receipt_load_by_pre_execution(text) from authenticated;
grant execute on function public.henyong_execution_receipt_load_by_pre_execution(text) to service_role;

create or replace function public.henyong_execution_receipt_append(
  p_receipt_id text,
  p_pre_execution_binding text,
  p_receipt jsonb
)
returns boolean
language plpgsql
security definer
set search_path = 'henyong_internal', 'pg_catalog'
as $$
declare
  affected_rows integer := 0;
begin
  if p_receipt_id is null
     or length(btrim(p_receipt_id)) < 1
     or length(btrim(p_receipt_id)) > 200 then
    raise exception 'invalid_receipt_id';
  end if;

  if p_pre_execution_binding is null
     or length(btrim(p_pre_execution_binding)) < 1
     or length(btrim(p_pre_execution_binding)) > 100000 then
    raise exception 'invalid_pre_execution_binding';
  end if;

  if p_receipt is null or jsonb_typeof(p_receipt) <> 'object' then
    raise exception 'invalid_receipt_payload';
  end if;

  if (p_receipt ->> 'version') is distinct from '2026-10-25.1' then
    raise exception 'invalid_execution_evidence_version';
  end if;

  if (p_receipt ->> 'trust') is distinct from 'EXECUTOR_IDENTITY_BOUND_UNAUTHENTICATED_RECEIPT' then
    raise exception 'invalid_execution_receipt_trust_label';
  end if;

  if jsonb_typeof(p_receipt -> 'receipt') is distinct from 'object' then
    raise exception 'invalid_nested_execution_receipt';
  end if;

  if (p_receipt -> 'receipt' ->> 'receiptId') is distinct from p_receipt_id then
    raise exception 'receipt_id_payload_mismatch';
  end if;

  if (p_receipt -> 'receipt' ->> 'preExecutionBinding') is distinct from p_pre_execution_binding then
    raise exception 'pre_execution_binding_payload_mismatch';
  end if;

  insert into henyong_internal.execution_receipts (
    receipt_id,
    pre_execution_binding,
    receipt,
    created_at
  )
  values (
    p_receipt_id,
    p_pre_execution_binding,
    p_receipt,
    now()
  )
  on conflict do nothing;

  get diagnostics affected_rows = row_count;
  return affected_rows = 1;
end;
$$;

revoke all on function public.henyong_execution_receipt_append(text, text, jsonb) from public;
revoke all on function public.henyong_execution_receipt_append(text, text, jsonb) from anon;
revoke all on function public.henyong_execution_receipt_append(text, text, jsonb) from authenticated;
grant execute on function public.henyong_execution_receipt_append(text, text, jsonb) to service_role;
