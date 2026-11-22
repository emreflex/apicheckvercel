import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";
import { parseArchive } from "../lib/archive";

const pendingFile = "pending_follow_requests.json";
const followingFile = "following.json";
const emptyPending = '{"relationships_follow_requests_sent":[]}';
const emptyFollowing = '{"relationships_following":[]}';

async function example(day: 1 | 2, filename: string) {
  const body = await readFile(`fixtures/instagram/day-${day}/${filename}`, "utf8");
  return new File([body], filename, { type: "application/json" });
}

test("iki Instagram dışa aktarımından yalnızca takip kullanıcı adlarını ve kaynak zamanlarını çıkarır", async () => {
  const first = await parseArchive(await Promise.all([example(1, pendingFile), example(1, followingFile)]));
  const second = await parseArchive(await Promise.all([example(2, pendingFile), example(2, followingFile)]));

  assert.deepEqual(first.pending, [
    { username: "bekleyen_hesap", timestamp: 1769853600 },
    { username: "belirsiz_hesap", timestamp: null },
    { username: "kabul_edilen", timestamp: 1769857200 },
  ]);
  assert.deepEqual(first.following, [{ username: "zaten_takipte", timestamp: 1769853600 }]);
  assert.deepEqual(second.pending, [{ username: "bekleyen_hesap", timestamp: 1769853600 }]);
  assert.deepEqual(second.following, [
    { username: "kabul_edilen", timestamp: 1770015600 },
    { username: "zaten_takipte", timestamp: 1769853600 },
  ]);
  assert.equal(first.archiveAt, null);
  assert.equal(second.archiveAt, null);
});

test("ZIP'te yalnızca izin verilen klasörlerden takip listesi çıkarır", async () => {
  const writer = new ZipWriter(new BlobWriter("application/zip"), { useWebWorkers: false });
  const folder = "instagram-example/connections/followers_and_following";
  await writer.add(`${folder}/${pendingFile}`, new TextReader(await (await example(1, pendingFile)).text()));
  await writer.add(`${folder}/${followingFile}`, new TextReader(emptyFollowing));
  await writer.add("messages/inbox/thread/message_1.json", new TextReader("private content"), { password: "private" });
  await writer.add(`messages/${pendingFile}`, new TextReader("private content"), { password: "private" });
  await writer.add(`${folder}/recent_follow_requests.json`, new TextReader("different list"), { password: "private" });
  const archive = new File([await writer.close()], "instagram-example-2026-02-03.zip");

  const result = await parseArchive([archive]);
  assert.equal(result.pending?.length, 3);
  assert.deepEqual(result.following, []);
  assert.equal(result.archiveAt, null);
});

test("eksik listeyi boş listeden ayırır ve tutarlı numaralandırılmış parçaları okur", async () => {
  assert.deepEqual(await parseArchive([new File([emptyPending], pendingFile)]), {
    pending: [], following: null, archiveAt: null,
  });
  assert.deepEqual(await parseArchive([new File([emptyFollowing], followingFile)]), {
    pending: null, following: [], archiveAt: null,
  });

  const followingFirst = new File([emptyFollowing], "following_1.json");
  const followingSecond = new File([emptyFollowing], "following_2.json");
  const followingThird = new File([emptyFollowing], "following_3.json");
  const complete = await parseArchive([followingSecond, followingFirst]);
  assert.deepEqual(complete.following, []);
  await assert.rejects(parseArchive([followingThird, followingFirst]), /eksik/);
  await assert.rejects(parseArchive([followingSecond]), /eksik/);
  await assert.rejects(parseArchive([followingFirst, new File([emptyFollowing], followingFile)]), /çakışan/);
});

test("geçersiz takip listesi ve tutarsız kayıt boş listeye dönüşmez", async () => {
  await assert.rejects(parseArchive([new File(["{}"], pendingFile)]), /beklenen Instagram liste/);
  await assert.rejects(parseArchive([new File(['{"relationships_follow_requests_sent":[{}]}'], pendingFile)]), /geçersiz/);
  const row = { title: "baska_hesap", string_list_data: [{ value: "bekleyen_hesap" }] };
  const inconsistent = JSON.stringify({ relationships_follow_requests_sent: [row] });
  await assert.rejects(parseArchive([new File([inconsistent], pendingFile)]), /geçersiz/);
});

test("yalnızca açık saat dilimi olan arşiv zamanını kabul eder", async () => {
  const metadata = (date: string) => new File([JSON.stringify({ archive_created_at: date })], "archive_metadata.json");
  const pending = new File([emptyPending], pendingFile);
  const result = await parseArchive([pending, metadata("2026-02-01T12:00:00+03:00")]);

  assert.equal(result.archiveAt, "2026-02-01T09:00:00.000Z");
  assert.equal((await parseArchive([pending, metadata("2026-02-01")])).archiveAt, null);
  assert.equal((await parseArchive([pending, metadata("2026-02-30T12:00:00+03:00")])).archiveAt, null);
  assert.equal((await parseArchive([pending, new File(["{"], "archive_metadata.json")])).archiveAt, null);
});
