import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { blockHash } from "../lib/hash";
import { miningProof } from "../lib/puzzles";
import { longestChain, scoreBranches } from "../lib/chain";
import type { PoolBlock } from "../lib/supabase";

test.skip(
  process.env.EVENT_E2E !== "1",
  "Requires the explicitly enabled isolated local Supabase stack",
);

test("complete 20-team event, four finalists, permissions, races, reloads and browser flow", async ({
  page,
  request,
  browser,
}) => {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:54321")
    throw new Error("Refusing a non-local simulation database");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    key = process.env.EVENT_SECRET!;
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const suffix = randomUUID().slice(0, 8),
    password = `Local-Test-${randomUUID()}!`;
  const checks: string[] = [],
    users: string[] = [],
    teams: {
      id: string;
      name: string;
      email: string;
      token: string;
      uid: string;
    }[] = [];
  const sql = (query: string) =>
    execFileSync(
      "docker",
      [
        "exec",
        "-i",
        "supabase_db_BlockHunt",
        "psql",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
        "-t",
        "-A",
      ],
      { input: query, encoding: "utf8" },
    ).trim();
  const resetWindows = () =>
    sql(
      `update stage_config set value=jsonb_build_object('open',false,'started_at',null,'duration_ms',case key when 'stage1' then 900000 when 'stage2' then 2400000 when 'stage3' then 1800000 else 1500000 end) || case key when 'stage2' then '{"difficulty_prefix":"0","nonce_max":100000000}'::jsonb when 'stage5' then '{"finalists":[]}'::jsonb else '{}'::jsonb end;`,
    );
  const call = async (path: string, token?: string, body?: unknown) => {
    const res = await request.fetch(path, {
      method: body === undefined ? "GET" : "POST",
      headers: token ? { authorization: `Bearer ${token}` } : {},
      ...(body === undefined ? {} : { data: body }),
    });
    return { status: res.status(), body: await res.json() };
  };
  const account = async (email: string) => {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    users.push(data.user!.id);
    const client = createClient(url, anon, { auth: { persistSession: false } });
    const login = await client.auth.signInWithPassword({ email, password });
    if (login.error) throw login.error;
    return { uid: data.user!.id, token: login.data.session!.access_token };
  };
  const loginUI = async (p: Page, email: string) => {
    await p.goto("/play");
    await p.getByPlaceholder("team email").fill(email);
    await p.getByPlaceholder("password", { exact: true }).fill(password);
    await p.getByRole("button", { name: "Log in", exact: true }).click();
  };
  try {
    // Reset only this task's local test database. Auth is cleaned up per test below.
    sql(
      `begin;delete from raw_submissions;delete from mining_pool;delete from teams;delete from stage_secrets where key='stage5_pool';update stage_config set value=(value-'started_at') || '{"open":false,"started_at":null}'::jsonb;commit;`,
    );
    resetWindows();
    const orgEmail = `organizer-${suffix}@blockhunt.test`;
    const org = await account(orgEmail);
    const added = await admin.from("admin_users").insert({ user_id: org.uid });
    if (added.error) throw added.error;
    const control = async (stage: number, open: boolean) => {
      const r = await call("/api/admin/config", org.token, {
        action: "stage",
        key: `stage${stage}`,
        open,
      });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      return r.body;
    };
    expect((await call("/api/forks")).status).toBe(401);
    expect((await call("/api/admin/config")).status).toBe(401);
    // One precreated Auth account claims its team through the real browser flow.
    const email = `team-0-${suffix}@blockhunt.test`,
      initial = await account(email);
    await loginUI(page, email);
    await expect(
      page.getByRole("heading", { name: "Claim your team" }),
    ).toBeVisible();
    await page
      .getByLabel("Team name", { exact: true })
      .fill(`Team00-${suffix}`);
    await page.getByRole("button", { name: "Claim team", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: `Team00-${suffix}` }),
    ).toBeVisible();
    const claimed = await call("/api/team", initial.token);
    expect(claimed.status).toBe(200);
    teams.push({
      id: claimed.body.team.id,
      name: claimed.body.team.name,
      email,
      ...initial,
    });
    // Create 19 other team accounts; one password/session per team.
    for (let i = 1; i < 20; i++) {
      const email = `team-${i}-${suffix}@blockhunt.test`,
        a = await account(email),
        name = `Team${String(i).padStart(2, "0")}-${suffix}`;
      const r = await call("/api/team", a.token, { name });
      expect(r.status).toBe(200);
      teams.push({ id: r.body.team.id, name, email, ...a });
    }
    checks.push(
      "20 real local Supabase Auth accounts; browser claim for a precreated account",
    );
    const t = teams[0],
      other = teams[1];
    expect((await call("/api/admin/config", t.token)).status).toBe(403);
    expect(
      (await call("/api/stage1", t.token, { order: [0, 1, 2, 3, 4, 5] }))
        .status,
    ).toBe(423);
    expect((await call("/api/forks", t.token)).status).toBe(423);
    const direct = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${t.token}` } },
      auth: { persistSession: false },
    });
    expect(
      (
        await direct.from("raw_submissions").insert({
          team_id: t.id,
          stage: 4,
          payload: { tx_hash: "fake" },
          correct: true,
          awarded: 50,
        })
      ).error,
    ).toBeTruthy();
    expect((await direct.from("mining_pool").select("*")).error).toBeTruthy();
    expect((await direct.from("stage_secrets").select("*")).error).toBeTruthy();
    const ownScores = await direct.from("scores").select("team_id");
    expect(ownScores.error).toBeNull();
    expect(ownScores.data).toEqual([{ team_id: t.id }]);
    expect(
      (
        await direct.rpc("event_submit", {
          p_team: t.id,
          p_stage: 1,
          p_correct: true,
          p_payload: {},
        })
      ).error,
    ).toBeTruthy();
    checks.push(
      "Closed stages, nonadmin controls, raw inserts, pool reads, secrets and scoring RPC rejected; own-score RLS verified",
    );
    const start = await control(1, true);
    await control(1, false);
    const reopen = await control(1, true);
    expect(reopen.value.started_at).toBe(start.value.started_at);
    await page.getByRole("button", { name: /Stage 1 · Sort/ }).click();
    await expect(page.getByText("Block 0", { exact: true })).toBeVisible();
    const puzzles = await Promise.all(
      teams.map(
        async (tm) =>
          (await call("/api/stage1", tm.token)).body.blocks as {
            index: number;
            prev: string;
            hash: string;
          }[],
      ),
    );
    const solve = (blocks: (typeof puzzles)[number]) => {
      const result: number[] = [];
      let prev = "00000000";
      while (result.length < blocks.length) {
        const b = blocks.find(
          (b) => b.prev === prev && !result.includes(b.index),
        );
        if (!b) throw new Error("Unsolvable chain");
        result.push(b.index);
        prev = b.hash;
      }
      return result;
    };
    const orders = puzzles.map(solve);
    const wrong = [...orders[0]].reverse();
    const race = await Promise.all([
      call("/api/stage1", t.token, { order: wrong }),
      call("/api/stage1", t.token, { order: wrong }),
    ]);
    expect(race.filter((r) => r.status === 200)).toHaveLength(1);
    expect(race.filter((r) => r.status === 429)).toHaveLength(1);
    await page.reload();
    await page.getByRole("button", { name: /Stage 1 · Sort/ }).click();
    await expect(
      page.getByRole("button", { name: "Submit order" }),
    ).toBeDisabled();
    expect((await call("/api/team", t.token)).body.score.stage1_attempts).toBe(
      1,
    );
    sql(
      `update scores set stage1_locked_until=clock_timestamp()-interval '1 second' where team_id='${t.id}';`,
    );
    // Solve first team through the UI and remaining teams concurrently over HTTP.
    await page.reload();
    await page.getByRole("button", { name: /Stage 1 · Sort/ }).click();
    await page
      .getByLabel("Chain order (comma separated labels)")
      .fill(orders[0].join(","));
    await page.getByRole("button", { name: "Submit order" }).click();
    await expect(page.getByText("Solved!", { exact: true })).toBeVisible();
    const sorted = await Promise.all(
      teams
        .slice(1)
        .map((tm, i) =>
          call("/api/stage1", tm.token, { order: orders[i + 1] }),
        ),
    );
    expect(sorted.every((r) => r.status === 200 && r.body.correct)).toBe(true);
    expect(
      (await call("/api/stage1", t.token, { order: orders[0] })).status,
    ).toBe(409);
    checks.push(
      "20 team-specific sorting puzzles solved; concurrent wrong guesses consume one attempt; reload retains lockout; re-open preserves clock",
    );
    await control(1, false);
    await control(2, true);
    const mine = async (tm: typeof t, parent: number | null = null) => {
      const path = `/api/stage2${parent === null ? "" : `?parent=${parent}`}`;
      const challenge = (await call(path, tm.token)).body;
      let nonce = 0;
      while (
        !miningProof(challenge.challenge.id, nonce, key).startsWith(
          challenge.config.difficulty_prefix,
        )
      )
        nonce++;
      return { path, nonce, id: challenge.challenge.id };
    };
    const jobs = await Promise.all(teams.map((tm) => mine(tm)));
    let losingNonce = 0;
    while (miningProof(jobs[19].id, losingNonce, key).startsWith("0"))
      losingNonce++;
    expect(
      (
        await call(jobs[19].path, teams[19].token, {
          nonce: losingNonce,
          challenge_id: jobs[19].id,
        })
      ).body.accepted,
    ).toBe(false);
    expect(
      (
        await call(jobs[19].path, teams[19].token, {
          nonce: jobs[19].nonce,
          challenge_id: jobs[19].id,
        })
      ).status,
    ).toBe(429);
    await new Promise((r) => setTimeout(r, 3100));
    expect(
      (
        await call("/api/stage2", other.token, {
          nonce: jobs[0].nonce,
          challenge_id: jobs[0].id,
        })
      ).status,
    ).toBe(409);
    expect((await call("/api/stage2?parent=999999999", t.token)).status).toBe(
      400,
    );
    await page.getByRole("button", { name: /Stage 2 · Mine/ }).click();
    await expect(page.getByLabel("Nonce", { exact: true })).toBeVisible();
    await page.getByLabel("Nonce", { exact: true }).fill(String(jobs[0].nonce));
    await page.getByRole("button", { name: "Try nonce", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Accepted block");
    const firstRoot = (await call("/api/stage2", t.token)).body.blocks[0].id;
    const roots = [
      { status: 200, body: { accepted: true, pool_id: firstRoot } },
      ...(await Promise.all(
        teams.slice(1).map((tm, i) =>
          call(jobs[i + 1].path, tm.token, {
            nonce: jobs[i + 1].nonce,
            challenge_id: jobs[i + 1].id,
          }),
        ),
      )),
    ];
    expect(roots.every((r) => r.status === 200 && r.body.accepted)).toBe(true);
    const stage2At = (await call("/api/team", t.token)).body.score
      .last_submit_at;
    const fresh = await mine(t, roots[0].body.pool_id);
    expect(
      (
        await call(fresh.path, t.token, {
          nonce: fresh.nonce,
          challenge_id: fresh.id,
        })
      ).status,
    ).toBe(429);
    await new Promise((r) => setTimeout(r, 3100));
    const minedRace = await Promise.all([
      call(fresh.path, t.token, { nonce: fresh.nonce, challenge_id: fresh.id }),
      call(fresh.path, t.token, { nonce: fresh.nonce, challenge_id: fresh.id }),
    ]);
    expect(minedRace.filter((r) => r.status === 200)).toHaveLength(1);
    expect(minedRace.filter((r) => [409, 429].includes(r.status))).toHaveLength(
      1,
    );
    expect((await call("/api/team", t.token)).body.score.last_submit_at).toBe(
      stage2At,
    );
    const childId = minedRace.find((r) => r.status === 200)!.body.pool_id;
    await new Promise((r) => setTimeout(r, 3100));
    const secondChild = await mine(t, roots[0].body.pool_id);
    expect(
      (
        await call(secondChild.path, t.token, {
          nonce: secondChild.nonce,
          challenge_id: secondChild.id,
        })
      ).body.accepted,
    ).toBe(true);
    await new Promise((r) => setTimeout(r, 3100));
    const grand = await mine(t, childId);
    expect(
      (
        await call(grand.path, t.token, {
          nonce: grand.nonce,
          challenge_id: grand.id,
        })
      ).body.accepted,
    ).toBe(true);
    const cleared = await call("/api/admin/config", org.token, {
      action: "secret",
      key: "stage2",
      value: { nonce_max: null },
    });
    expect(cleared.status).toBe(200);
    expect(cleared.body.value.nonce_max).toBeUndefined();
    // Score row is unchanged by an idempotent ensure-team call.
    const before = (await call("/api/team", t.token)).body.score;
    expect(
      (await call("/api/team", t.token, { name: t.name })).body.score,
    ).toEqual(before);
    checks.push(
      "20 accepted server-bound mining proofs; copied challenge and missing parent rejected; cooldown/race single winner; extra mining keeps tie timestamp; nonce cap clears",
    );
    await control(2, false);
    await control(3, true);
    const evidence = await Promise.all(
      teams.map(
        async (tm) =>
          (await call("/api/stage3", tm.token)).body.blocks as {
            index: number;
            prev: string;
            nonce: number;
            data: string;
            hash: string;
          }[],
      ),
    );
    const bad = evidence.map(
      (blocks) =>
        blocks.find((b) => blockHash(b.prev, b.nonce, b.data) !== b.hash)!
          .index,
    );
    const explanation =
      "Recomputed hash differs from the stored hash for the changed data. Descendants still reference the old hash, breaking verified continuity.";
    await page.getByRole("button", { name: /Stage 3 · Forger/ }).click();
    await expect(
      page.getByRole("button", { name: "hashes", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "hashes", exact: true }).click();
    mkdirSync("test-results", { recursive: true });
    await page.screenshot({
      path: "test-results/investigation-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "test-results/investigation-mobile.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByLabel("Tampered block label").fill(String(bad[0]));
    await page.getByLabel("Evidence (30..5120 characters)").fill(explanation);
    await page.getByRole("button", { name: "Submit investigation" }).click();
    await expect(
      page.getByText("Solved; explanation awaits judging.", { exact: true }),
    ).toBeVisible();
    const s3 = await Promise.all(
      teams.slice(1).map((tm, i) =>
        call("/api/stage3", tm.token, {
          tampered_block: bad[i + 1],
          explanation,
        }),
      ),
    );
    expect(s3.every((r) => r.status === 200 && r.body.correctBlock)).toBe(true);
    const judgeContext = await browser.newContext();
    const judgePage = await judgeContext.newPage();
    await judgePage.goto("/admin");
    await judgePage.getByPlaceholder("organizer email").fill(orgEmail);
    await judgePage
      .getByPlaceholder("password", { exact: true })
      .fill(password);
    await judgePage
      .getByRole("button", { name: "Log in", exact: true })
      .click();
    await expect(
      judgePage.getByRole("heading", { name: "Stage control", exact: true }),
    ).toBeVisible();
    await judgePage.getByLabel("Team", { exact: true }).selectOption(t.id);
    await expect(
      judgePage.getByText(`Block ${bad[0]}: ${explanation}`, { exact: true }),
    ).toBeVisible();
    await judgePage.getByLabel("Rubric points").fill("20");
    await judgePage.getByRole("button", { name: "Save judging" }).click();
    await expect(
      judgePage.getByText("Judging saved.", { exact: true }),
    ).toBeVisible();
    await judgePage.screenshot({
      path: "test-results/judging-desktop.png",
      fullPage: true,
    });
    await judgeContext.close();
    for (let i = 1; i < teams.length; i++) {
      expect(
        (
          await call("/api/admin/config", org.token, {
            action: "judge",
            team_id: teams[i].id,
            points: i === 0 ? 20 : i < 4 ? 19 : 0,
          })
        ).status,
      ).toBe(200);
    }
    expect(
      (
        await call("/api/admin/config", org.token, {
          action: "judge",
          team_id: t.id,
          points: 21,
        })
      ).status,
    ).toBe(400);
    checks.push(
      "20 digital investigations solved from evidence; split tabs usable; admin rubric points validated",
    );
    await control(3, false);
    await control(4, true);
    const collision = await Promise.all(
      teams.map(async (tm) => {
        const p = (await call("/api/stage4", tm.token)).body,
          nonces: number[] = [];
        for (let n = 0; n < 10000 && nonces.length < 2; n++)
          if (blockHash(p.prev, n, p.data) === p.target) nonces.push(n);
        expect(nonces).toHaveLength(2);
        return { nonce_a: nonces[0], nonce_b: nonces[1] };
      }),
    );
    await page.getByRole("button", { name: /Stage 4 · Bonus/ }).click();
    await page.getByLabel("First nonce").fill(String(collision[0].nonce_a));
    await page.getByLabel("Second nonce").fill(String(collision[0].nonce_b));
    await page.getByRole("button", { name: "Submit collision" }).click();
    await expect(
      page.getByText("+50 points awarded", { exact: true }),
    ).toBeVisible();
    const s4 = await Promise.all(
      teams
        .slice(1)
        .map((tm, i) => call("/api/stage4", tm.token, collision[i + 1])),
    );
    expect(s4.every((r) => r.status === 200 && r.body.awarded === 50)).toBe(
      true,
    );
    expect((await call("/api/stage4", t.token, collision[0])).status).toBe(409);
    await control(4, false);
    const leaderboard = (await call("/api/leaderboard")).body.rows;
    const finalistNames = leaderboard
      .slice(0, 4)
      .map((r: { team: string }) => r.team);
    const finalists = teams.filter((tm) => finalistNames.includes(tm.name));
    expect(finalists).toHaveLength(4);
    expect(finalistNames).toContain(t.name);
    expect(
      (
        await call("/api/admin/config", org.token, {
          action: "finalists",
          finalists: finalistNames.join(","),
        })
      ).status,
    ).toBe(200);
    await control(5, true);
    const excluded = teams.find((tm) => !finalistNames.includes(tm.name))!;
    expect((await call("/api/forks", excluded.token)).status).toBe(403);
    expect(
      (
        await call("/api/stage5", excluded.token, {
          branches: [{ block_ids: [1] }],
          longest_branch_index: 0,
        })
      ).status,
    ).toBe(403);
    const fork = (await call("/api/forks", t.token)).body;
    expect(fork.longest).toBeUndefined();
    expect(
      fork.blocks.every((b: PoolBlock) =>
        finalists.some((tm) => tm.id === b.team_id),
      ),
    ).toBe(true);
    const byId = new Map<number, PoolBlock>(
      fork.blocks.map((b: PoolBlock) => [b.id, b]),
    );
    const paths = fork.blocks.map((b: PoolBlock) => {
      const ids: number[] = [];
      let current: PoolBlock | undefined = b;
      while (current) {
        ids.unshift(current.id);
        current =
          current.parent_block === null
            ? undefined
            : byId.get(current.parent_block);
      }
      return ids;
    });
    paths.sort((a: number[], b: number[]) => b.length - a.length);
    expect(longestChain(fork.blocks)).toBe(3);
    const answer = {
      branches: paths.map((block_ids: number[]) => ({ block_ids })),
      longest_branch_index: 0,
    };
    const finaleRace = await Promise.all([
      call("/api/stage5", t.token, answer),
      call("/api/stage5", t.token, answer),
    ]);
    expect(finaleRace.filter((r) => r.status === 200)).toHaveLength(1);
    expect(finaleRace.filter((r) => r.status === 409)).toHaveLength(1);
    const expected = scoreBranches(fork.blocks, paths, 0);
    expect(finaleRace.find((r) => r.status === 200)!.body.awarded).toBe(
      expected.branch_pts + expected.longest_pts,
    );
    const uiFinalist = finalists.find((tm) => tm.id !== t.id)!;
    const context = await browser.newContext();
    const secondPage = await context.newPage();
    await loginUI(secondPage, uiFinalist.email);
    await secondPage.getByRole("button", { name: /S5 · Finale/ }).click();
    await secondPage
      .getByLabel("One branch per line, comma separated pool IDs")
      .fill(paths.map((ids: number[]) => ids.join(",")).join("\n"));
    await secondPage
      .getByLabel("Longest branch line index (first line is 0)")
      .fill("0");
    await secondPage
      .getByRole("button", { name: "Submit finale branches" })
      .click();
    await expect(secondPage.getByRole("status")).toContainText("longest +100");
    await context.close();
    for (const tm of finalists.filter(
      (tm) => tm.id !== t.id && tm.id !== uiFinalist.id,
    ))
      expect((await call("/api/stage5", tm.token, answer)).status).toBe(200);
    const frozen = JSON.stringify(fork.blocks);
    await control(5, false);
    await control(5, true);
    expect(
      JSON.stringify((await call("/api/forks", t.token)).body.blocks),
    ).toBe(frozen);
    expect(
      (
        await call("/api/admin/config", org.token, {
          action: "finalists",
          finalists: excluded.name,
        })
      ).status,
    ).toBe(409);
    await page.goto("/forks");
    await expect(
      page.getByRole("heading", { name: "The shared chain pool" }),
    ).toBeVisible();
    await expect(page.getByText("Parent ID: genesis").first()).toBeVisible();
    mkdirSync("test-results", { recursive: true });
    await page.screenshot({
      path: "test-results/finale-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/play");
    await expect(page.getByRole("heading", { name: t.name })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "test-results/team-mobile.png",
      fullPage: true,
    });
    await page.goto("/leaderboard");
    await expect(page.getByRole("heading")).toBeVisible();
    expect((await call("/api/team", "expired-invalid-token")).status).toBe(401);
    // Expired windows are rejected even when the organizer hasn't manually closed them.
    sql(
      `update stage_config set value=value || jsonb_build_object('open',true,'started_at',(clock_timestamp()-interval '1 day')::text,'duration_ms',1000) where key='stage1';`,
    );
    expect((await call("/api/stage1", other.token)).status).toBe(423);
    expect((await call("/api/stages")).body.stages.stage1.open).toBe(false);
    const final = (await call("/api/leaderboard")).body.rows;
    for (const tm of teams) {
      const sc = (await call("/api/team", tm.token)).body.score;
      expect(sc.total).toBe(
        sc.stage1_base +
          sc.stage1_bonus +
          sc.stage2_base +
          sc.stage2_bonus +
          sc.stage3_base +
          sc.stage3_bonus +
          sc.stage3_expl +
          sc.stage4_bonus +
          sc.stage5_branches +
          sc.stage5_longest,
      );
    }
    checks.push(
      "20 collisions automatically scored; four leaders selected; finalist-only frozen pool; no longest disclosure; atomic finale; consistent totals; expired sessions/windows; desktop/mobile/reload flows",
    );
    writeFileSync(
      "test-results/event-summary.json",
      JSON.stringify(
        { teams: 20, finalists: 4, checks, finalLeaderboard: final },
        null,
        2,
      ),
    );
  } finally {
    for (const uid of users) await admin.auth.admin.deleteUser(uid);
    resetWindows();
    await admin.from("stage_secrets").delete().eq("key", "stage5_pool");
  }
});
