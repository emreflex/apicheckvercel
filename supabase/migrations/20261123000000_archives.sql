create schema if not exists private;

create table private.app_owner (
  singleton boolean primary key default true check (singleton),
  user_id uuid not null references auth.users(id) on delete cascade
);

alter table private.app_owner enable row level security;

create function public.is_app_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.app_owner where user_id = (select auth.uid())
  );
$$;

create table private.archives (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  archive_at timestamptz not null check (archive_at >= '0001-01-01T00:00:00Z' and archive_at < '10000-01-01T00:00:00Z'),
  pending_count integer check (pending_count between 0 and 100000),
  following_count integer check (following_count between 0 and 100000),
  created_at timestamptz not null default now(),
  uploaded_at timestamptz,
  content_hash bytea,
  duplicate_of uuid references private.archives(id) on delete cascade,
  check (pending_count is not null or following_count is not null),
  check ((uploaded_at is not null) = (content_hash is not null)),
  check (duplicate_of is null or uploaded_at is null),
  unique (owner_id, content_hash)
);

create table private.archive_records (
  archive_id uuid not null references private.archives(id) on delete cascade,
  kind text not null check (kind in ('pending', 'following')),
  row_index integer not null check (row_index between 0 and 99999),
  username text not null check (username ~ '^[a-z0-9._]{1,30}$'),
  source_timestamp bigint check (source_timestamp between 0 and 253402300799),
  primary key (archive_id, kind, row_index),
  unique (archive_id, kind, username)
);

create index archives_completed_by_owner
  on private.archives (owner_id, archive_at desc, id desc)
  where uploaded_at is not null;

create index archives_unpublished_by_owner
  on private.archives (owner_id, created_at)
  where uploaded_at is null;

alter table private.archives enable row level security;
alter table private.archive_records enable row level security;

create policy owner_reads_archives
  on private.archives for select to authenticated
  using (
    owner_id = (select auth.uid())
    and (select public.is_app_owner())
    and uploaded_at is not null
  );

create policy owner_reads_archive_records
  on private.archive_records for select to authenticated
  using (
    exists (
      select 1 from private.archives a
      where a.id = archive_id and a.owner_id = (select auth.uid()) and a.uploaded_at is not null
    )
    and (select public.is_app_owner())
  );

revoke all on private.app_owner, private.archives, private.archive_records from public, anon, authenticated;
grant usage on schema private to authenticated;
grant select on private.archives, private.archive_records to authenticated;

create function public.begin_archive_import(
  p_id uuid,
  p_archive_at timestamptz,
  p_pending_count integer,
  p_following_count integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_archive private.archives%rowtype;
  v_owner uuid := auth.uid();
begin
  if not public.is_app_owner() then
    raise exception using errcode = '42501', message = 'Bu işlem için yetkiniz yok.';
  end if;

  if p_id is null or p_archive_at is null
     or p_archive_at < '0001-01-01T00:00:00Z' or p_archive_at >= '10000-01-01T00:00:00Z'
     or (p_pending_count is null and p_following_count is null)
     or p_pending_count not between 0 and 100000
     or p_following_count not between 0 and 100000 then
    raise exception using errcode = '22023', message = 'Arşiv bilgileri geçersiz.';
  end if;

  -- Remove abandoned drafts on later imports without a scheduled job.
  delete from private.archives
  where id in (
    select id from private.archives
    where owner_id = v_owner and uploaded_at is null and id <> p_id
      and created_at < now() - interval '48 hours'
    order by created_at
    limit 25
    for update skip locked
  );

  insert into private.archives (id, owner_id, archive_at, pending_count, following_count)
  values (p_id, v_owner, p_archive_at, p_pending_count, p_following_count)
  on conflict (id) do nothing;

  select * into v_archive from private.archives where id = p_id and owner_id = v_owner;

  if not found
     or v_archive.archive_at is distinct from p_archive_at
     or v_archive.pending_count is distinct from p_pending_count
     or v_archive.following_count is distinct from p_following_count then
    raise exception using errcode = '23505', message = 'Bu yükleme kimliği başka bir arşive ait.';
  end if;
end;
$$;

create function public.append_archive_records(
  p_id uuid,
  p_kind text,
  p_offset integer,
  p_records jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_archive private.archives%rowtype;
  v_expected_count integer;
  v_length integer;
begin
  if not public.is_app_owner() then
    raise exception using errcode = '42501', message = 'Bu işlem için yetkiniz yok.';
  end if;

  if p_kind is null or p_kind not in ('pending', 'following')
     or p_offset is null or p_offset not between 0 and 99999
     or p_records is null or jsonb_typeof(p_records) <> 'array' then
    raise exception using errcode = '22023', message = 'Kayıt grubu geçersiz.';
  end if;

  v_length := jsonb_array_length(p_records);
  if v_length not between 1 and 250 then
    raise exception using errcode = '22023', message = 'Bir grupta 1 ila 250 kayıt olmalı.';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_records) as r(item)
    where jsonb_typeof(r.item) <> 'object'
       or jsonb_typeof(r.item->'username') is distinct from 'string'
       or r.item->>'username' !~ '^[a-z0-9._]{1,30}$'
       or not (r.item ? 'timestamp')
       or (
         jsonb_typeof(r.item->'timestamp') <> 'null'
         and (jsonb_typeof(r.item->'timestamp') <> 'number'
           or r.item->>'timestamp' !~ '^[0-9]{1,12}$')
       )
  ) then
    raise exception using errcode = '22023', message = 'Kayıt grubunda geçersiz takip verisi var.';
  end if;

  select * into v_archive from private.archives
   where id = p_id and owner_id = auth.uid() for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Yükleme bulunamadı.';
  end if;

  v_expected_count := case p_kind when 'pending' then v_archive.pending_count else v_archive.following_count end;
  if v_expected_count is null or p_offset + v_length > v_expected_count then
    raise exception using errcode = '22023', message = 'Kayıt grubu bildirilen liste boyutunu aşıyor.';
  end if;

  if v_archive.uploaded_at is not null or v_archive.duplicate_of is not null then
    return;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_records) with ordinality as r(item, position)
    join private.archive_records s
      on s.archive_id = p_id and s.kind = p_kind and s.row_index = p_offset + r.position - 1
    where s.username <> r.item->>'username'
       or s.source_timestamp is distinct from (r.item->>'timestamp')::bigint
  ) then
    raise exception using errcode = '23505', message = 'Kayıt grubu daha önce gönderilen verilerle çakışıyor.';
  end if;

  insert into private.archive_records (archive_id, kind, row_index, username, source_timestamp)
  select p_id, p_kind, p_offset + r.position - 1, r.item->>'username', (r.item->>'timestamp')::bigint
  from jsonb_array_elements(p_records) with ordinality as r(item, position)
  on conflict (archive_id, kind, row_index) do nothing;
end;
$$;

create function public.finish_archive_import(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_archive private.archives%rowtype;
  v_pending_count bigint;
  v_following_count bigint;
  v_records jsonb;
  v_hash bytea;
  v_duplicate uuid;
begin
  if not public.is_app_owner() then
    raise exception using errcode = '42501', message = 'Bu işlem için yetkiniz yok.';
  end if;

  select * into v_archive from private.archives
   where id = p_id and owner_id = auth.uid() for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Yükleme bulunamadı.';
  end if;

  if v_archive.uploaded_at is not null or v_archive.duplicate_of is not null then
    return jsonb_build_object('id', coalesce(v_archive.duplicate_of, p_id), 'duplicate', v_archive.duplicate_of is not null);
  end if;

  select count(*) filter (where kind = 'pending'),
         count(*) filter (where kind = 'following'),
         coalesce(jsonb_agg(
           jsonb_build_array(kind, username, source_timestamp) order by kind collate "C", username collate "C"
         ), '[]'::jsonb)
    into v_pending_count, v_following_count, v_records
    from private.archive_records where archive_id = p_id;

  if v_pending_count <> coalesce(v_archive.pending_count, 0)
     or v_following_count <> coalesce(v_archive.following_count, 0) then
    raise exception using errcode = '22023', message = 'Yükleme henüz tamamlanmadı.';
  end if;

  v_hash := sha256(convert_to(jsonb_build_array(
    extract(epoch from v_archive.archive_at),
    v_archive.pending_count,
    v_archive.following_count,
    v_records
  )::text, 'UTF8'));

  -- Finalizations for one owner share a lock so a duplicate cannot win a race.
  perform pg_advisory_xact_lock(hashtextextended(v_archive.owner_id::text, 0));

  select id into v_duplicate from private.archives where owner_id = v_archive.owner_id and content_hash = v_hash;
  if found then
    delete from private.archive_records where archive_id = p_id;
    update private.archives set duplicate_of = v_duplicate where id = p_id;
    return jsonb_build_object('id', v_duplicate, 'duplicate', true);
  end if;

  update private.archives set uploaded_at = clock_timestamp(), content_hash = v_hash where id = p_id;
  return jsonb_build_object('id', p_id, 'duplicate', false);
end;
$$;

create function public.get_archive_snapshots(
  p_before_archive_at timestamptz default null,
  p_before_id uuid default null
)
returns table (id uuid, archive_at timestamptz, uploaded_at timestamptz, pending jsonb, following jsonb)
language sql
stable
security invoker
set search_path = ''
as $$
  with candidates as (
    select a.id, a.archive_at, a.uploaded_at, a.pending_count, a.following_count
    from private.archives a
    where (select public.is_app_owner())
      and a.owner_id = (select auth.uid())
      and a.uploaded_at is not null
      and (p_before_archive_at is null or (a.archive_at, a.id) < (p_before_archive_at, p_before_id))
    order by a.archive_at desc, a.id desc
    limit 8
  ), page as (
    select c.*, row_number() over archive_order as position,
      sum(coalesce(c.pending_count, 0) + coalesce(c.following_count, 0)) over archive_order as record_total
    from candidates c
    window archive_order as (order by c.archive_at desc, c.id desc)
  )
  select p.id, p.archive_at, p.uploaded_at,
    case when p.pending_count is not null then coalesce((
      select jsonb_agg(jsonb_build_object('username', r.username, 'timestamp', r.source_timestamp) order by r.username collate "C")
      from private.archive_records r where r.archive_id = p.id and r.kind = 'pending'
    ), '[]'::jsonb) end,
    case when p.following_count is not null then coalesce((
      select jsonb_agg(jsonb_build_object('username', r.username, 'timestamp', r.source_timestamp) order by r.username collate "C")
      from private.archive_records r where r.archive_id = p.id and r.kind = 'following'
    ), '[]'::jsonb) end
  from page p
  where p.position = 1 or p.record_total <= 25000
  order by p.archive_at desc, p.id desc;
$$;

revoke all on function public.is_app_owner() from public, anon, authenticated;
revoke all on function public.begin_archive_import(uuid, timestamptz, integer, integer) from public, anon, authenticated;
revoke all on function public.append_archive_records(uuid, text, integer, jsonb) from public, anon, authenticated;
revoke all on function public.finish_archive_import(uuid) from public, anon, authenticated;
revoke all on function public.get_archive_snapshots(timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.is_app_owner() to authenticated;
grant execute on function public.begin_archive_import(uuid, timestamptz, integer, integer) to authenticated;
grant execute on function public.append_archive_records(uuid, text, integer, jsonb) to authenticated;
grant execute on function public.finish_archive_import(uuid) to authenticated;
grant execute on function public.get_archive_snapshots(timestamptz, uuid) to authenticated;
