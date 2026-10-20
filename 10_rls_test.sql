-- Row-level-security test. Run by scripts/test-rls.sh after the migration.
-- Any failed expectation raises an exception and the script aborts.
\set ON_ERROR_STOP on
create temp table _r (n int);
create or replace function pg_temp.expect(label text, cond boolean) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL: %', label; end if;
  raise notice 'ok   %', label;
end $$;

-- people
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner@x.test');                       -- first -> owner
insert into auth.users (id, email, invited_at) values ('00000000-0000-0000-0000-00000000000b', 'editor@x.test', now());     -- invited -> editor
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000c', 'stranger@x.test');                      -- signup -> pending
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000d', 'viewer@x.test');
select pg_temp.expect('first user is owner', (select role from profiles where email = 'owner@x.test') = 'owner');
select pg_temp.expect('invited user is editor', (select role from profiles where email = 'editor@x.test') = 'editor');
select pg_temp.expect('uninvited signup is pending', (select role from profiles where email = 'stranger@x.test') = 'pending');

-- owner promotes viewer
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select set_member_role('00000000-0000-0000-0000-00000000000d', 'viewer');
select pg_temp.expect('owner sets viewer role', (select role from profiles where email = 'viewer@x.test') = 'viewer');
insert into items (id, data) values ('i1', '{"name":"bag"}');
insert into config (id, data) values ('main', '{"kursEveDidi":2720}');
select pg_temp.expect('owner can write', (select count(*) from items) = 1);
select pg_temp.expect('rev assigned', (select rev from items where id = 'i1') > 0);
select pg_temp.expect('updated_by stamped', (select updated_by from items where id = 'i1') = '00000000-0000-0000-0000-00000000000a');
do $$ declare r1 bigint; r2 bigint; begin
  select rev into r1 from items where id = 'i1';
  update items set data = '{"name":"bag2"}' where id = 'i1';
  select rev into r2 from items where id = 'i1';
  perform pg_temp.expect('rev increases on update', r2 > r1);
end $$;
select pg_temp.expect('owner sees all profiles', (select count(*) from profiles) = 4);

-- editor
reset role; set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
insert into shipments (id, data) values ('s1', '{}');
update items set data = '{"name":"edited"}' where id = 'i1';
select pg_temp.expect('editor can write', (select data ->> 'name' from items where id = 'i1') = 'edited');
delete from shipments where id = 's1';
select pg_temp.expect('editor can delete', (select count(*) from shipments) = 0);
do $$ begin
  begin perform set_member_role('00000000-0000-0000-0000-00000000000c', 'editor'); raise exception 'should not be allowed';
  exception when insufficient_privilege then perform pg_temp.expect('editor cannot change roles', true); end;
  begin update profiles set role = 'owner' where id = '00000000-0000-0000-0000-00000000000b'; raise exception 'should not be allowed';
  exception when insufficient_privilege then perform pg_temp.expect('editor cannot self-promote', true); end;
end $$;

-- viewer
reset role; set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
select pg_temp.expect('viewer can read', (select count(*) from items) = 1);
do $$ begin
  begin insert into items (id, data) values ('i2', '{}'); raise exception 'should not be allowed';
  exception when insufficient_privilege then perform pg_temp.expect('viewer cannot insert', true); end;
end $$;
update items set data = '{"name":"hack"}' where id = 'i1';
select pg_temp.expect('viewer update changes nothing', (select data ->> 'name' from items where id = 'i1') = 'edited');
delete from items where id = 'i1';
select pg_temp.expect('viewer delete changes nothing', (select count(*) from items) = 1);

-- pending
reset role; set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select pg_temp.expect('pending sees no items', (select count(*) from items) = 0);
select pg_temp.expect('pending sees no config', (select count(*) from config) = 0);
select pg_temp.expect('pending sees only own profile', (select count(*) from profiles) = 1);
do $$ begin
  begin insert into items (id, data) values ('i3', '{}'); raise exception 'should not be allowed';
  exception when insufficient_privilege then perform pg_temp.expect('pending cannot insert', true); end;
end $$;

-- anon
reset role; set role anon; reset request.jwt.claim.sub;
do $$ begin
  begin perform count(*) from items; raise exception 'should not be allowed';
  exception when insufficient_privilege then perform pg_temp.expect('anon cannot read items', true); end;
end $$;

-- last owner protection
reset role; set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin
  begin perform set_member_role('00000000-0000-0000-0000-00000000000a', 'editor'); raise exception 'should not be allowed';
  exception when check_violation then perform pg_temp.expect('cannot demote the last owner', true); end;
end $$;
select set_member_role('00000000-0000-0000-0000-00000000000c', 'editor');
select pg_temp.expect('owner approves pending user', (select role from profiles where email='stranger@x.test') = 'editor');
select set_member_role('00000000-0000-0000-0000-00000000000b', 'owner');
select set_member_role('00000000-0000-0000-0000-00000000000a', 'editor');
select pg_temp.expect('can demote self once another owner exists', (select role from profiles where email='owner@x.test') = 'editor');
select set_my_name('Miranda');
select pg_temp.expect('set_my_name works', (select name from profiles where email='owner@x.test') = 'Miranda');
\echo ALL RLS TESTS PASSED
