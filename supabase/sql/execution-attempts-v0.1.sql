-- Execution attempt reservation v0.1
-- Authoritative idempotency boundary BEFORE a real side effect.
-- Source contract only; no live project mutation is performed here.

create schema if not exists henyong_internal;

revoke all on schema henyong_internal from public;
revoke all on schema henyong_internal from anon;
revoke all on schema henyong_internal from authenticated;
grant usage on schema henyong_internal to service_role;

create table if not exists henyong_internal.execution_attempts (
  pre_execution_binding text primary key,
  attempt_id text not null unique,
  status text not null check (status in ('RESERVED', 'FINALIZED')),
  claim jsonb not null check (jsonb_typeof(claim) = 'object'),
  receipt jsonb,
  reserved_at timestamptz not null,
  finalized_at timestamptz,
  check (length(btrim(pre_execution_binding)) between 1 and 100000),
  check (length(btrim(attempt_id)) between 1 and 200),
  check ((status = 'RESERVED' and receipt is null and finalized_at is null)
      or (status = 'FINALIZED' and receipt is not null and finalized_at is not null))
);

revoke all on table henyong_internal.execution_attempts from public;
revoke all on table henyong_internal.execution_attempts from anon;
revoke all on table henyong_internal.execution_attempts from authenticated;
grant select, insert, update on table henyong_internal.execution_attempts to service_role;

create or replace function public.henyong_execution_attempt_load(
  p_pre_execution_binding text
)
returns table (
  status text,
  claim jsonb,
  receipt jsonb
)
language sql
security definer
set search_path = 'henyong_internal', 'pg_catalog'
as $$
  select ea.status, ea.claim, ea.receipt
  from henyong_internal.execution_attempts as ea
  where ea.pre_execution_binding = p_pre_execution_binding;
$$;

revoke all on function public.henyong_execution_attempt_load(text) from public;
revoke all on function public.henyong_execution_attempt_load(text) from anon;
revoke all on function public.henyong_execution_attempt_load(text) from authenticated;
grant execute on function public.henyong_execution_attempt_load(text) to service_role;

create or replace function public.henyong_execution_attempt_reserve(
  p_pre_execution_binding text,
  p_attempt_id text,
  p_claim jsonb,
  p_reserved_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = 'henyong_internal', 'pg_catalog'
as $$
declare
  affected_rows integer := 0;
begin
  if p_pre_execution_binding is null
     or length(btrim(p_pre_execution_binding)) < 1
     or length(btrim(p_pre_execution_binding)) > 100000 then
    raise exception 'invalid_pre_execution_binding';
  end if;

  if p_attempt_id is null
     or length(btrim(p_attempt_id)) < 1
     or length(btrim(p_attempt_id)) > 200 then
    raise exception 'invalid_attempt_id';
  end if;

  if p_claim is null or jsonb_typeof(p_claim) <> 'object' then
    raise exception 'invalid_execution_attempt_claim';
  end if;

  if (p_claim ->> 'version') is distinct from '2026-10-25.1' then
    raise exception 'invalid_execution_attempt_version';
  end if;

  if (p_claim ->> 'attemptId') is distinct from p_attempt_id then
    raise exception 'attempt_id_payload_mismatch';
  end if;

  if (p_claim ->> 'preExecutionBinding') is distinct from p_pre_execution_binding then
    raise exception 'pre_execution_binding_payload_mismatch';
  end if;

  insert into henyong_internal.execution_attempts (
    pre_execution_binding,
    attempt_id,
    status,
    claim,
    receipt,
    reserved_at,
    finalized_at
  )
  values (
    p_pre_execution_binding,
    p_attempt_id,
    'RESERVED',
    p_claim,
    null,
    p_reserved_at,
    null
  )
  on conflict do nothing;

  get diagnostics affected_rows = row_count;
  return affected_rows = 1;
end;
$$;

revoke all on function public.henyong_execution_attempt_reserve(text, text, jsonb, timestamptz) from public;
revoke all on function public.henyong_execution_attempt_reserve(text, text, jsonb, timestamptz) from anon;
revoke all on function public.henyong_execution_attempt_reserve(text, text, jsonb, timestamptz) from authenticated;
grant execute on function public.henyong_execution_attempt_reserve(text, text, jsonb, timestamptz) to service_role;

create or replace function public.henyong_execution_attempt_finalize(
  p_pre_execution_binding text,
  p_expected_attempt_id text,
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
  if p_receipt is null or jsonb_typeof(p_receipt) <> 'object' then
    raise exception 'invalid_execution_receipt';
  end if;

  if (p_receipt ->> 'version') is distinct from '2026-10-25.1' then
    raise exception 'invalid_execution_evidence_version';
  end if;

  if (p_receipt ->> 'trust') is distinct from 'EXECUTOR_IDENTITY_BOUND_UNAUTHENTICATED_RECEIPT' then
    raise exception 'invalid_execution_receipt_trust_label';
  end if;

  if (p_receipt -> 'receipt' ->> 'preExecutionBinding') is distinct from p_pre_execution_binding then
    raise exception 'receipt_pre_execution_binding_mismatch';
  end if;

  update henyong_internal.execution_attempts
  set status = 'FINALIZED',
      receipt = p_receipt,
      finalized_at = now()
  where pre_execution_binding = p_pre_execution_binding
    and attempt_id = p_expected_attempt_id
    and status = 'RESERVED';

  get diagnostics affected_rows = row_count;
  return affected_rows = 1;
end;
$$;

revoke all on function public.henyong_execution_attempt_finalize(text, text, jsonb) from public;
revoke all on function public.henyong_execution_attempt_finalize(text, text, jsonb) from anon;
revoke all on function public.henyong_execution_attempt_finalize(text, text, jsonb) from authenticated;
grant execute on function public.henyong_execution_attempt_finalize(text, text, jsonb) to service_role;
