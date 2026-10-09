import { test, expect } from "@playwright/test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { teamPuzzles } from "../lib/puzzles";
import { blockHash } from "../lib/hash";
import { longestChain, scoreBranches, validBranch } from "../lib/chain";
import type { PoolBlock } from "../lib/supabase";

test("team puzzles are stable, different, and contain exactly one altered block", () => {
  const key = "test-secret-which-is-at-least-32-chars";
  for (let i = 0; i < 100; i++) {
    const p = teamPuzzles(String(i), key);
    expect(teamPuzzles(String(i), key)).toEqual(p);
    expect(p.order).not.toEqual([0, 1, 2, 3, 4, 5]);
    expect(new Set(p.sort.map((b) => b.hash)).size).toBe(6);
    expect(p.sort.every((b) => b.hash !== "00000000")).toBe(true);
    expect(
      p.evidence
        .filter((b) => blockHash(b.prev, b.nonce, b.data) !== b.hash)
        .map((b) => b.index),
    ).toEqual([p.tampered]);
    let prev = "00000000";
    for (const label of p.order) {
      const b = p.sort.find((b) => b.index === label)!;
      expect(b.prev).toBe(prev);
      prev = b.hash;
    }
  }
  expect(teamPuzzles("a", key).sort).not.toEqual(teamPuzzles("b", key).sort);
});

test("chain scoring rejects repeated zero-hash blocks, orphans, false parents and cycles", () => {
  const block = (
    id: number,
    parent_block: number | null,
    prev_hash: string,
    nonce: number,
    data: string,
  ): PoolBlock => ({
    id,
    parent_block,
    prev_hash,
    nonce: String(nonce),
    data,
    hash: blockHash(prev_hash, nonce, data),
    team_id: "t",
    block_index: id,
    parent_team: null,
    valid: true,
    created_at: "",
  });
  const zero = block(1, null, "00000000", 29999999, "A");
  expect(zero.hash).toBe("00000000");
  const child = block(2, 1, zero.hash, 12, "B"),
    fork = block(3, 1, zero.hash, 21, "C");
  const orphan = block(4, null, child.hash, 11, "D");
  const falseParent = block(5, 2, zero.hash, 10, "E");
  const pool = [zero, child, fork, orphan, falseParent];
  const byId = new Map(pool.map((b) => [b.id, b]));
  expect(validBranch([1, 1], byId)).toBe(false);
  expect(validBranch([4], byId)).toBe(false);
  expect(validBranch([1, 2, 5], byId)).toBe(false);
  expect(longestChain(pool)).toBe(2);
  expect(scoreBranches(pool, [[1], [1], [1, 1], [1, 2], [1, 3]], 3)).toEqual({
    valid_branches: 3,
    branch_pts: 30,
    longest_pts: 100,
  });
  expect(longestChain([{ ...zero, parent_block: 1 }])).toBe(0);
});

test("fresh schema, reapplication, legacy rename and access permissions execute in PostgreSQL", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function auth.role() returns text language sql stable as $$select current_user::text$$;
      grant usage on schema auth to anon,authenticated,service_role;grant execute on all functions in schema auth to anon,authenticated,service_role;`);
    const schema = readFileSync("supabase/schema.sql", "utf8"),
      event = readFileSync("supabase/event.sql", "utf8");
    await db.exec(schema + event);
    await db.exec(schema + event);
    const uid = "10000000-0000-0000-0000-000000000001";
    await db.exec(
      `insert into auth.users values('${uid}');insert into public.teams(auth_uid,name) values('${uid}','Migration Team');alter table public.scores rename column stage2_last_attempt_at to stage2_last_nonce;update public.scores set stage2_last_nonce='2026-10-09 00:00:00Z';`,
    );
    await db.exec(schema + event);
    expect(
      (
        await db.query<{ stage2_last_attempt_at: Date }>(
          "select stage2_last_attempt_at from scores",
        )
      ).rows[0].stage2_last_attempt_at.toISOString(),
    ).toBe("2026-10-09T00:00:00.000Z");
    await db.exec(
      `alter table scores add column stage2_last_nonce timestamptz;update scores set stage2_last_nonce='2026-10-08 00:00:00Z';`,
    );
    await db.exec(schema + event);
    expect(
      (
        await db.query(
          "select column_name from information_schema.columns where table_name='scores' and column_name='stage2_last_nonce'",
        )
      ).rows,
    ).toHaveLength(0);
    const permissions = (
      await db.query<{ audit: boolean; pool: boolean; rpc: boolean }>(
        `select has_table_privilege('authenticated','raw_submissions','insert') as audit,has_table_privilege('authenticated','mining_pool','select') as pool,has_function_privilege('authenticated','event_submit(uuid,integer,boolean,jsonb)','execute') as rpc`,
      )
    ).rows[0];
    expect(permissions).toEqual({ audit: false, pool: false, rpc: false });
    await db.exec(`set role authenticated;set request.jwt.claim.sub='${uid}';`);
    expect((await db.query("select * from scores")).rows).toHaveLength(1);
    await expect(
      db.exec(
        "insert into raw_submissions(team_id,stage,payload) select team_id,4,'{}'::jsonb from scores",
      ),
    ).rejects.toThrow();
    await db.exec("reset role;");
    const team = (
      await db.query<{ team_id: string }>("select team_id from scores")
    ).rows[0].team_id;
    await db.query("select event_control('stage1',true)");
    for (let i = 0; i < 3; i++) {
      const result = (
        await db.query<{ result: { status?: number; attemptsLeft: number } }>(
          "select event_submit($1,1,false,'{}') as result",
          [team],
        )
      ).rows[0].result;
      expect(result.status).toBeUndefined();
      expect(result.attemptsLeft).toBe(2 - i);
      expect(
        (
          await db.query<{ result: { status: number } }>(
            "select event_submit($1,1,true,'{}') as result",
            [team],
          )
        ).rows[0].result.status,
      ).toBe(429);
      await db.query(
        "update scores set stage1_locked_until=clock_timestamp()-interval '1 second'",
      );
    }
    expect(
      (
        await db.query<{ result: { status: number } }>(
          "select event_submit($1,1,true,'{}') as result",
          [team],
        )
      ).rows[0].result.status,
    ).toBe(429);
    expect(
      (
        await db.query<{ stage1_attempts: number; total: number }>(
          "select stage1_attempts,total from scores",
        )
      ).rows[0],
    ).toEqual({ stage1_attempts: 3, total: 0 });
    await db.query("select event_control('stage3',true)");
    expect(
      (
        await db.query<{ result: { correct: boolean } }>(
          "select event_submit($1,3,false,'{}') as result",
          [team],
        )
      ).rows[0].result.correct,
    ).toBe(false);
    expect(
      (
        await db.query<{ result: { status: number } }>(
          "select event_submit($1,3,true,'{}') as result",
          [team],
        )
      ).rows[0].result.status,
    ).toBe(429);
    await db.query(
      "update scores set stage3_locked_until=clock_timestamp()-interval '1 second'",
    );
    expect(
      (
        await db.query<{ result: { awarded: number } }>(
          "select event_submit($1,3,true,'{}') as result",
          [team],
        )
      ).rows[0].result.awarded,
    ).toBe(150);
    await db.query("select event_control('stage4',true)");
    await db.exec(
      `create function reject_test_audit() returns trigger language plpgsql as $$begin raise exception 'Simulated audit persistence failure';end;$$;create trigger fail_audit before insert on raw_submissions for each row execute function reject_test_audit();`,
    );
    await expect(
      db.query("select event_submit($1,4,true,'{}')", [team]),
    ).rejects.toThrow("Simulated audit persistence failure");
    expect(
      (
        await db.query<{ stage4_bonus: number; stage4_last_attempt_at: null }>(
          "select stage4_bonus,stage4_last_attempt_at from scores",
        )
      ).rows[0],
    ).toEqual({ stage4_bonus: 0, stage4_last_attempt_at: null });
  } finally {
    await db.close();
  }
});
