-- Run as postgres on a migrated test database. Fixture changes are rolled back.
begin;

insert into auth.users (id)
values ('20000000-0000-4000-8000-000000000001'), ('20000000-0000-4000-8000-000000000002');

insert into private.app_owner (user_id) values ('20000000-0000-4000-8000-000000000001')
on conflict (singleton) do update set user_id = excluded.user_id;

set local role anon;
do $$
begin
  begin
    perform public.get_archive_snapshots();
    raise exception 'Anon can read snapshots';
  exception when insufficient_privilege then null;
  end;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000001', true);

do $$
declare
  day_one constant uuid := '30000000-0000-4000-8000-000000000001';
  day_two constant uuid := '30000000-0000-4000-8000-000000000002';
  retry constant uuid := '30000000-0000-4000-8000-000000000003';
  is_duplicate jsonb;
begin
  if not public.is_app_owner() then raise exception 'Owner was rejected'; end if;

  perform public.begin_archive_import(day_two, '2025-01-02T10:00:00Z', 1, 1);
  perform public.append_archive_records(day_two, 'pending', 0, '[{"username":"ayse","timestamp":null}]');

  if exists (select 1 from public.get_archive_snapshots())
     or exists (select 1 from private.archives)
     or exists (select 1 from private.archive_records) then
    raise exception 'Partial import is visible';
  end if;

  begin
    perform public.finish_archive_import(day_two);
    raise exception 'Partial import was sealed';
  exception when invalid_parameter_value then null;
  end;

  perform public.append_archive_records(day_two, 'pending', 0, '[{"username":"ayse","timestamp":null}]');

  begin
    perform public.append_archive_records(day_two, 'pending', 0, '[{"username":"ali","timestamp":null}]');
    raise exception 'A conflicting retry was accepted';
  exception when unique_violation then null;
  end;

  perform public.append_archive_records(day_two, 'following', 0, '[{"username":"ali","timestamp":null}]');
  if public.finish_archive_import(day_two) <> jsonb_build_object('id', day_two, 'duplicate', false) then
    raise exception 'First import result differs';
  end if;
  if public.finish_archive_import(day_two) <> jsonb_build_object('id', day_two, 'duplicate', false) then
    raise exception 'Finalization was not idempotent';
  end if;

  perform public.begin_archive_import(day_one, '2025-01-01T10:00:00Z', 3, 0);
  perform public.append_archive_records(day_one, 'pending', 0, '[
    {"username":"ali","timestamp":1735632000},{"username":"ayse","timestamp":null},{"username":"can","timestamp":null}
  ]');
  perform public.finish_archive_import(day_one);

  perform public.begin_archive_import(retry, '2025-01-01T13:00:00+03:00', 3, 0);
  perform public.append_archive_records(retry, 'pending', 0, '[
    {"username":"can","timestamp":null},{"username":"ayse","timestamp":null},{"username":"ali","timestamp":1735632000}
  ]');
  is_duplicate := public.finish_archive_import(retry);
  if is_duplicate <> jsonb_build_object('id', day_one, 'duplicate', true) then
    raise exception 'Canonical deduplication failed: %', is_duplicate;
  end if;
  if public.finish_archive_import(retry) <> is_duplicate then
    raise exception 'Duplicate finalization was not idempotent';
  end if;
  if (select count(*) from public.get_archive_snapshots()) <> 2 then
    raise exception 'Duplicate changed snapshot count';
  end if;
  if not exists (
    select 1 from public.get_archive_snapshots('2025-01-02T10:00:00Z', day_two)
    where id = day_one and following = '[]'::jsonb
  ) then
    raise exception 'Cursor or explicit empty list was lost';
  end if;

  perform public.begin_archive_import('30000000-0000-4000-8000-000000000004', '2025-01-03T10:00:00Z', null, 0);
  perform public.finish_archive_import('30000000-0000-4000-8000-000000000004');
  if not exists (
    select 1 from public.get_archive_snapshots()
    where id = '30000000-0000-4000-8000-000000000004' and pending is null and following = '[]'::jsonb
  ) then
    raise exception 'Missing lists and empty lists were conflated';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', true);

do $$
begin
  if public.is_app_owner()
     or exists (select 1 from public.get_archive_snapshots())
     or exists (select 1 from private.archives)
     or exists (select 1 from private.archive_records) then
    raise exception 'Another authenticated user can read archives';
  end if;

  begin
    perform public.begin_archive_import('30000000-0000-4000-8000-000000000005', '2025-01-02T10:00:00Z', 0, null);
    raise exception 'Another authenticated user can change archives';
  exception when insufficient_privilege then null;
  end;
end;
$$;

rollback;
