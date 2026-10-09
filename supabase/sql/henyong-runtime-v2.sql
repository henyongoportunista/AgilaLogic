-- Henyong Runtime v2 database support
-- No secret values are stored in source control.

-- 1) Create an internal dispatch token only when absent.
do $$
begin
  if not exists (
    select 1 from vault.decrypted_secrets where name = 'henyong_dispatch_token'
  ) then
    perform vault.create_secret(
      encode(gen_random_bytes(48), 'base64'),
      'henyong_dispatch_token'
    );
  end if;
end
$$;

-- 2) Service-role-only token validation for the Edge Function.
create or replace function public.henyong_validate_dispatch_token(p_token text)
returns boolean
language sql
security definer
set search_path = 'vault', 'pg_catalog'
as $$
  select exists (
    select 1
    from vault.decrypted_secrets
    where name = 'henyong_dispatch_token'
      and decrypted_secret = p_token
  );
$$;

revoke all on function public.henyong_validate_dispatch_token(text) from public;
revoke all on function public.henyong_validate_dispatch_token(text) from anon;
revoke all on function public.henyong_validate_dispatch_token(text) from authenticated;
grant execute on function public.henyong_validate_dispatch_token(text) to service_role;

-- 3) Dispatch queued work to the v2 runtime. The project URL, publishable key,
-- and private dispatch token are read from Vault at execution time.
create or replace function henyong_internal.dispatch_pending()
returns bigint
language plpgsql
set search_path to 'public', 'vault', 'net', 'pg_catalog'
as $$
declare
  request_id bigint;
begin
  if not exists (
    select 1
    from public.event_inbox
    where status = 'queued'
      and available_at <= now()
    limit 1
  ) then
    return null;
  end if;

  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'henyong_project_url'
    ) || '/functions/v1/henyong-runtime',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'henyong_publishable_key'
      ),
      'x-henyong-dispatch', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'henyong_dispatch_token'
      )
    ),
    body := jsonb_build_object('op', 'drain', 'limit', 5),
    timeout_milliseconds := 15000
  ) into request_id;

  return request_id;
end;
$$;

-- 4) Terminal decisions never remain falsely pending.
create or replace function public.henyong_normalize_terminal_decision_status()
returns trigger
language plpgsql
set search_path = 'public'
as $$
begin
  if new.gate in (
       'OBSERVE_ONLY'::public.decision_gate,
       'REJECT'::public.decision_gate
     )
     and coalesce(new.approval_required, false) = false
     and new.status = 'pending'::public.record_status then
    new.status := 'verified'::public.record_status;
  end if;
  return new;
end;
$$;

drop trigger if exists henyong_terminal_decision_status_trg on public.decisions;
create trigger henyong_terminal_decision_status_trg
before insert or update of gate, approval_required, status
on public.decisions
for each row
execute function public.henyong_normalize_terminal_decision_status();
