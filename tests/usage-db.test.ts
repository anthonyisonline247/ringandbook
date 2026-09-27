import { PGlite } from 'npm:@electric-sql/pglite@0.3.14';
import assert from 'node:assert/strict';
Deno.test('Postgres billing ledger: thresholds, replay, conflicts, trial and monthly reset', async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users(id uuid primary key);`);
    for (const file of ['202609200001_billing.sql','202609200002_usage.sql']) await pg.exec(await Deno.readTextFile(new URL('../supabase/migrations/'+file,import.meta.url)));
    const user = '00000000-0000-4000-8000-000000000001';
    await pg.query('insert into auth.users values($1)',[user]);
    await pg.query("insert into billing_accounts(user_id,plan,period) values($1,'starter','monthly')",[user]);
    const call = async (id: string, seconds: number, month=10, trial=false) => (await pg.query<{billable_minutes:number}>(
      'select * from record_billing_call($1,$2,$3,$4,$5,$6,$7)',[user,id,seconds,`2026-${month}-15T00:00:00Z`,`2026-${month}-01T00:00:00Z`,`2026-${month+1}-01T00:00:00Z`,trial])).rows[0];
    assert.equal((await call('allowance',15000)).billable_minutes,0);
    assert.equal((await call('one-second',1)).billable_minutes,1);
    assert.equal((await call('one-second',1)).billable_minutes,1);
    assert.equal((await call('within-rounded-minute',59)).billable_minutes,0);
    assert.equal((await call('next-minute',1)).billable_minutes,1);
    await assert.rejects(() => call('one-second',2));
    const cycle = (await pg.query<{seconds:number}>('select seconds from billing_usage_cycles where user_id=$1',[user])).rows[0];
    assert.equal(Number(cycle.seconds),15061);
    assert.equal((await call('new-month',1,11)).billable_minutes,0);
    assert.equal((await call('trial',42001,9,true)).billable_minutes,0);
    const token='00000000-0000-4000-8000-000000000002';
    assert.equal((await pg.query<{locked:boolean}>('select lock_billing($1,$2) as locked',[user,token])).rows[0].locked,true);
    assert.equal((await pg.query<{locked:boolean}>('select lock_billing($1,$2) as locked',[user,token])).rows[0].locked,false);
    await pg.exec('set role authenticated');
    await assert.rejects(() => pg.query('select * from billing_accounts'));
    await assert.rejects(() => pg.query('select lock_billing($1,$2)',[user,token]));
    await pg.exec('reset role');
  } finally { await pg.close(); }
});
