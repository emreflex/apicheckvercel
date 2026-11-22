import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeArchives, filterRequestRows, getPeriodCounts } from "../lib/analysis";
import type { ArchiveRecord, ArchiveSnapshot } from "../lib/domain";

const firstDay = "2025-04-01T20:59:00.000Z";
const secondDay = "2025-04-01T21:00:00.000Z";
const thirdDay = "2025-04-02T21:00:00.000Z";
const fourthDay = "2025-04-03T21:00:00.000Z";
const fifthDay = "2025-04-04T21:00:00.000Z";

function records(...usernames: string[]): ArchiveRecord[] {
  return usernames.map((username) => ({ username, timestamp: null }));
}

function snapshot(
  id: string,
  archiveAt: string,
  pending: ArchiveRecord[] | null,
  following: ArchiveRecord[] | null,
  uploadedAt = archiveAt,
): ArchiveSnapshot {
  return { id, archiveAt, pending, following, uploadedAt };
}

const firstArchive = snapshot("first", firstDay, [
  { username: "bekleyen", timestamp: 1743465600 },
  ...records("kabul", "belirsiz"),
], records("eski.takip"));
const secondArchive = snapshot("second", secondDay, records("bekleyen"), records("kabul", "eski.takip"));

test("two archive dates resolve three requests as pending, observed accepted and uncertain", () => {
  const first = analyzeArchives([firstArchive]);
  assert.deepEqual(getPeriodCounts(first), { pending: 3, accepted: 0, uncertain: 0 });

  const result = analyzeArchives([firstArchive, secondArchive]);
  assert.deepEqual(getPeriodCounts(result), { pending: 1, accepted: 1, uncertain: 1 });
  assert.deepEqual(result.rows.map(({ username, status }) => [username, status]), [
    ["bekleyen", "pending"], ["belirsiz", "uncertain"], ["kabul", "accepted"],
  ]);
  const accepted = result.rows.find((row) => row.username === "kabul");
  assert.equal(accepted?.observedFrom, firstDay);
  assert.equal(accepted?.at, secondDay);
  assert.equal(accepted?.sentAt, null);
  assert.equal(result.rows.find((row) => row.username === "bekleyen")?.sentAt, 1743465600);
  assert.deepEqual(result.changes.filter(({ archiveId }) => archiveId === "second").map(({ username }) => username).sort(),
    ["belirsiz", "kabul"]);
});

test("same archive uploaded again has no effect on counts or history", () => {
  const baseline = analyzeArchives([firstArchive, secondArchive]);
  const reimported = { ...secondArchive, id: "reimport", uploadedAt: thirdDay };
  const result = analyzeArchives([firstArchive, secondArchive, reimported]);
  assert.deepEqual(getPeriodCounts(result), getPeriodCounts(baseline));
  assert.deepEqual(result.changes.map(({ username, status, at }) => ({ username, status, at })),
    baseline.changes.map(({ username, status, at }) => ({ username, status, at })));
  assert.deepEqual(result.rows.map(({ history }) => history.length), baseline.rows.map(({ history }) => history.length));
});

test("a later upload of an old archive recomputes history by archive date", () => {
  const historical = { ...firstArchive, uploadedAt: thirdDay };
  const result = analyzeArchives([secondArchive, historical]);
  assert.deepEqual(getPeriodCounts(result), { pending: 1, accepted: 1, uncertain: 1 });
  assert.equal(result.latestArchiveAt, secondDay);
  assert.equal(result.latestUploadAt, thirdDay);
  assert.equal(result.latestPendingAt, secondDay);
  assert.deepEqual(result.rows.find((row) => row.username === "kabul")?.history.map(({ at }) => at),
    [firstDay, secondDay]);
});

test("complete empty and absent lists are different evidence", () => {
  const initial = snapshot("first", firstDay, records("hesap"), null);
  const partial = snapshot("second", secondDay, [], null);
  const partialResult = analyzeArchives([initial, partial, snapshot("third", thirdDay, null, [])]);
  const row = partialResult.rows[0];
  assert.equal(row.status, "pending");
  assert.equal(row.at, firstDay);
  assert.equal(row.insufficientAt, thirdDay);
  assert.equal(partialResult.pendingCount, 0);
  assert.equal(partialResult.latestPendingAt, secondDay);
  assert.equal(partialResult.changes.length, 1);
  assert.equal(filterRequestRows(partialResult, { status: "insufficient" })[0].username, "hesap");
  assert.deepEqual(getPeriodCounts(analyzeArchives([snapshot("following", firstDay, null, [])])),
    { pending: null, accepted: 0, uncertain: 0 });

  const complete = analyzeArchives([initial, partial, snapshot("third", thirdDay, [], [])]);
  assert.equal(complete.rows[0].status, "uncertain");
  assert.equal(complete.rows[0].insufficientAt, null);
});

test("acceptance can follow uncertainty and a later request starts a fresh observation range", () => {
  const result = analyzeArchives([
    snapshot("first", firstDay, records("hesap"), null),
    snapshot("second", secondDay, [], []),
    snapshot("third", thirdDay, [], records("hesap")),
    snapshot("fourth", fourthDay, records("hesap"), records("hesap")),
    snapshot("fifth", fifthDay, [], records("hesap")),
  ]);
  assert.deepEqual(result.changes.map(({ status }) => status), ["pending", "uncertain", "accepted", "pending", "accepted"]);
  assert.deepEqual(result.changes.filter(({ status }) => status === "accepted").map(({ observedFrom }) => observedFrom),
    [firstDay, fourthDay]);
  assert.deepEqual(getPeriodCounts(result), { pending: 0, accepted: 1, uncertain: 1 });
});

test("positive following evidence can establish acceptance when a new pending list is missing", () => {
  const result = analyzeArchives([
    snapshot("first", firstDay, records("hesap", "diger"), null),
    snapshot("second", secondDay, null, records("hesap")),
  ]);
  assert.equal(result.pendingCount, 2);
  assert.equal(result.latestPendingAt, firstDay);
  assert.equal(result.rows.find(({ username }) => username === "hesap")?.status, "accepted");
  assert.equal(result.rows.find(({ username }) => username === "diger")?.insufficientAt, secondDay);
});

test("exactly coincident observations can fill gaps but cannot supply chronological order", () => {
  const tiedPending = snapshot("pending", secondDay, records("ikinci"), null);
  const tiedFollowing = snapshot("following", secondDay, null, records("ilk", "ikinci"));
  const earlier = snapshot("earlier", firstDay, records("ilk"), null);
  const result = analyzeArchives([tiedPending, tiedFollowing, earlier]);
  assert.deepEqual(result.rows.map(({ username, status }) => [username, status]), [
    ["ikinci", "pending"], ["ilk", "accepted"],
  ]);
  const conflicting = snapshot("conflict", secondDay, records("baska", "ilk"), null);
  const conflictResult = analyzeArchives([tiedPending, tiedFollowing, earlier, conflicting]);
  assert.equal(conflictResult.rows[0].status, "pending");
  assert.equal(conflictResult.rows[0].insufficientAt, secondDay);
  assert.equal(conflictResult.latestPendingAt, firstDay);
});

test("inclusive period filters use Europe/Istanbul dates and keep the latest pending count", () => {
  const result = analyzeArchives([firstArchive, secondArchive]);
  assert.deepEqual(getPeriodCounts(result, "2025-04-01", "2025-04-01"),
    { pending: 1, accepted: 0, uncertain: 0 });
  assert.deepEqual(getPeriodCounts(result, "2025-04-02", "2025-04-02"),
    { pending: 1, accepted: 1, uncertain: 1 });
  assert.deepEqual(filterRequestRows(result, {
    query: "  @KAB  ", status: "accepted", startDate: "2025-04-02",
  }).map(({ username }) => username), ["kabul"]);
  assert.equal(filterRequestRows(result, { status: "accepted", endDate: "2025-04-01" }).length, 0);
});
