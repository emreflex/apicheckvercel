import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { analyzeArchives, getPeriodCounts } from "../lib/analysis";
import { parseArchive } from "../lib/archive";
import type { ArchiveSnapshot } from "../lib/domain";
import { fromIstanbulDate } from "../lib/istanbul";

async function readSnapshot(day: "day-1" | "day-2", date: string): Promise<ArchiveSnapshot> {
  const files = await Promise.all(["pending_follow_requests.json", "following.json"].map(async (name) => {
    const path = new URL(`../fixtures/instagram/${day}/${name}`, import.meta.url);
    return new File([await readFile(path, "utf8")], name, { type: "application/json" });
  }));
  const parsed = await parseArchive(files);
  assert.equal(parsed.archiveAt, null);
  const archiveAt = fromIstanbulDate(date, "12:00");
  assert.ok(archiveAt);
  return { ...parsed, id: day, archiveAt, uploadedAt: archiveAt };
}

test("sample Instagram JSON archives flow through parsing and the dashboard counters", async () => {
  const first = await readSnapshot("day-1", "2026-02-01");
  const second = await readSnapshot("day-2", "2026-02-02");
  assert.deepEqual(getPeriodCounts(analyzeArchives([first])), { pending: 3, accepted: 0, uncertain: 0 });

  const result = analyzeArchives([first, second]);
  const expected = { pending: 1, accepted: 1, uncertain: 1 };
  assert.deepEqual(getPeriodCounts(result), expected);
  assert.deepEqual(Object.fromEntries(result.rows.map(({ username, status }) => [username, status])), {
    bekleyen_hesap: "pending",
    kabul_edilen: "accepted",
    belirsiz_hesap: "uncertain",
  });

  const repeated = { ...second, id: "again", uploadedAt: "2026-02-03T09:00:00.000Z" };
  assert.deepEqual(getPeriodCounts(analyzeArchives([first, second, repeated])), expected);
});
