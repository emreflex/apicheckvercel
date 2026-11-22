import type { FileEntry } from "@zip.js/zip.js";
import type { ArchiveRecord } from "./domain";

const MIB = 1024 * 1024;
const MAX_JSON_BYTES = 12 * MIB;
const MAX_TOTAL_JSON_BYTES = 40 * MIB;
const MAX_ZIP_METADATA_BYTES = 48 * MIB;
const MAX_ZIP_ENTRIES = 250_000;
const MAX_PARTS = 128;
const MAX_METADATA_BYTES = 64 * 1024;
const MAX_RECORDS_PER_LIST = 100_000;
const USERNAME = /^[A-Za-z0-9._]{1,30}$/;

const relationshipKey = {
  pending: "relationships_follow_requests_sent",
  following: "relationships_following",
} as const;

type ListKind = keyof typeof relationshipKey;

export type ParsedArchive = {
  pending: ArchiveRecord[] | null;
  following: ArchiveRecord[] | null;
  archiveAt: string | null;
};

type ListPart = { kind: ListKind; part: number | null; folder: string; name: string };
type MetadataPart = { kind: "metadata"; folder: string; name: string };
type ArchivePart = ListPart | MetadataPart;

type Source = {
  part: ArchivePart;
  size: number;
  read: () => Promise<string>;
};

class ArchiveError extends Error {}

function fail(message: string): never {
  throw new ArchiveError(message);
}

function identifyPath(path: string): ArchivePart | null {
  const names = path.toLowerCase().split("/");
  const name = names.pop() ?? "";
  if (names.some((segment) => !segment || segment === "." || segment === "..")) return null;

  const folder = names.join("/");
  if (names[0]?.startsWith("instagram-")) names.shift();
  const section = names.join("/");

  if (name === "archive_metadata.json" && section === "") return { kind: "metadata", folder, name };
  if (section !== "" && section !== "connections/followers_and_following" && section !== "followers_and_following") {
    return null;
  }

  if (name === "pending_follow_requests.json") return { kind: "pending", part: null, folder, name };
  const following = /^following(?:_([0-9]+))?\.json$/.exec(name);
  if (!following) return null;

  const part = following[1] ? Number(following[1]) : null;
  if (part !== null && (part < 1 || part > MAX_PARTS || String(part) !== following[1])) {
    fail("Takip listesindeki parça numarası geçersiz.");
  }
  return { kind: "following", part, folder, name };
}

function assertSize(source: Source) {
  if (!Number.isSafeInteger(source.size) || source.size < 0 || source.size > MAX_JSON_BYTES) {
    fail(`${source.part.name} dosyası boyut sınırını aşıyor.`);
  }
}

async function readZipJson(entry: FileEntry, part: ArchivePart): Promise<string> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const chunks: string[] = [];
  let size = 0;
  const sink = new WritableStream<Uint8Array>({
    write(chunk) {
      size += chunk.byteLength;
      if (size > entry.uncompressedSize) fail(`${part.name} dosyasının ZIP boyutu doğrulanamadı.`);
      chunks.push(decoder.decode(chunk, { stream: true }));
    },
  });
  await entry.getData(sink, { checkSignature: true, checkOverlappingEntry: true });
  if (size !== entry.uncompressedSize) fail(`${part.name} dosyasının ZIP boyutu doğrulanamadı.`);
  chunks.push(decoder.decode());
  return chunks.join("");
}

async function parseZip(file: File): Promise<ParsedArchive> {
  const { BlobReader, ZipReader } = await import("@zip.js/zip.js");

  class ArchiveBlobReader extends BlobReader {
    override async readUint8Array(offset: number, length: number) {
      if (length > MAX_ZIP_METADATA_BYTES) fail("ZIP dosyasındaki dosya dizini çok büyük.");
      return super.readUint8Array(offset, length);
    }
  }

  const reader = new ZipReader(new ArchiveBlobReader(file));
  let count = 0;
  const sources: Source[] = [];
  try {
    for await (const entry of reader.getEntriesGenerator()) {
      if (++count > MAX_ZIP_ENTRIES) fail("ZIP dosyası çok fazla öğe içeriyor.");
      if (entry.directory) continue;
      const part = identifyPath(entry.filename);
      if (!part) continue;
      if (entry.encrypted) {
        if (part.kind === "metadata") continue;
        fail("Takip listelerini içeren ZIP dosyasının parolası kaldırılmalı.");
      }
      sources.push({ part, size: entry.uncompressedSize, read: () => readZipJson(entry, part) });
      if (sources.length > MAX_PARTS + 2) fail("Çok fazla takip listesi parçası seçildi.");
    }
    return await parseSources(sources);
  } catch (error) {
    if (error instanceof ArchiveError) throw error;
    fail("ZIP dosyası açılamadı. Instagram arşivini tekrar indirmeyi dene.");
  } finally {
    await reader.close();
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const username = value.trim();
  return USERNAME.test(username) ? username.toLowerCase() : null;
}

function usernameFromProfile(href: unknown): string | null {
  if (typeof href !== "string") return null;
  try {
    const profile = new URL(href);
    if (profile.protocol !== "https:" || !["instagram.com", "www.instagram.com"].includes(profile.host)) return null;
    const match = /^(?:\/_u)?\/([a-z0-9._]{1,30})\/?$/i.exec(profile.pathname);
    return match ? asUsername(match[1]) : null;
  } catch {
    return null;
  }
}

function parseRelationships(value: unknown, part: ListPart, records: Map<string, ArchiveRecord>) {
  const list = isObject(value) ? value[relationshipKey[part.kind]] : null;
  if (!Array.isArray(list)) fail(`${part.name} beklenen Instagram liste yapısında değil.`);

  for (const [index, relationship] of list.entries()) {
    const invalid = () => fail(`${part.name} dosyasındaki ${index + 1}. takip kaydı geçersiz.`);
    if (!isObject(relationship)) return invalid();
    const values = relationship.string_list_data;
    if (!Array.isArray(values) || values.length !== 1 || !isObject(values[0])) return invalid();
    const details = values[0];
    const valueUsername = asUsername(details.value);
    const titleUsername = asUsername(relationship.title);
    const hrefUsername = usernameFromProfile(details.href);
    const username = valueUsername ?? titleUsername ?? hrefUsername;
    if (!username || [valueUsername, titleUsername, hrefUsername].some((declared) => declared && declared !== username)) {
      return invalid();
    }

    const rawTimestamp = details.timestamp;
    let timestamp: number | null = null;
    if (rawTimestamp !== undefined && rawTimestamp !== null && rawTimestamp !== 0) {
      if (typeof rawTimestamp !== "number" || !Number.isSafeInteger(rawTimestamp) || rawTimestamp < 0 || rawTimestamp > 253402300799) {
        return invalid();
      }
      timestamp = rawTimestamp;
    }

    const previous = records.get(username);
    if (previous?.timestamp != null && timestamp != null && previous.timestamp !== timestamp) {
      fail(`${part.name} dosyasında aynı hesap için farklı tarihler var.`);
    }
    records.set(username, { username, timestamp: previous?.timestamp ?? timestamp });
    if (records.size > MAX_RECORDS_PER_LIST) fail(`${part.name} dosyasındaki liste kayıt sınırını aşıyor.`);
  }
}

function parseArchiveTime(value: unknown): string | null {
  const timestamp = isObject(value) ? value.archive_created_at : null;
  if (typeof timestamp !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(timestamp);
  if (!match) return null;

  const wallTime = new Date(`${match[1]}Z`);
  const canonical = new Date(timestamp);
  if (!Number.isFinite(wallTime.valueOf()) || !wallTime.toISOString().startsWith(match[1])) return null;
  if (!Number.isFinite(canonical.valueOf()) || canonical.valueOf() > Date.now() || canonical.getUTCFullYear() < 2010) return null;
  return canonical.toISOString();
}

async function findArchiveTime(sources: Source[], listFolder: string): Promise<string | null> {
  const candidates = sources.filter(({ part, size }) => {
    const sameExport = !part.folder || listFolder === part.folder || listFolder.startsWith(`${part.folder}/`);
    return part.kind === "metadata" && Number.isSafeInteger(size) && size >= 0 && size <= MAX_METADATA_BYTES && sameExport;
  });
  if (candidates.length !== 1) return null;

  try {
    return parseArchiveTime(JSON.parse(await candidates[0].read()));
  } catch {
    return null;
  }
}

function validateParts(parts: ListPart[]) {
  if (new Set(parts.map((part) => part.folder)).size > 1) {
    fail("Takip listeleri ZIP içinde farklı klasörlerde. Aynı arşive ait listeleri birlikte seç.");
  }
  if (parts.filter((part) => part.kind === "pending").length > 1) {
    fail("Birden fazla bekleyen istek listesi bulundu.");
  }
  const following = parts.filter((part) => part.kind === "following");
  if (following.length === 1 && following[0].part === null) return;

  const numbers = following.map((part) => part.part ?? 0).sort((a, b) => a - b);
  if (numbers.some((number, index) => number !== index + 1)) {
    fail("Takip listesinde eksik, tekrarlanan veya çakışan parçalar var. Aynı arşivin tüm parçalarını birlikte seç.");
  }
}

async function parseSources(sources: Source[]): Promise<ParsedArchive> {
  const listSources = sources.filter((source): source is Source & { part: ListPart } => source.part.kind !== "metadata");
  const listParts = listSources.map(({ part }) => part);
  if (!listParts.length) fail("Arşivde pending_follow_requests.json veya following.json bulunamadı.");
  validateParts(listParts);

  for (const source of listSources) assertSize(source);
  if (listSources.reduce((total, source) => total + source.size, 0) > MAX_TOTAL_JSON_BYTES) {
    fail("Takip listelerinin toplam boyutu desteklenen sınırı aşıyor.");
  }

  const result: ParsedArchive = { pending: null, following: null, archiveAt: null };
  const records = { pending: new Map<string, ArchiveRecord>(), following: new Map<string, ArchiveRecord>() };

  for (const { part, read } of listSources) {
    let value: unknown;
    try {
      value = JSON.parse(await read());
    } catch (error) {
      if (error instanceof ArchiveError) throw error;
      fail(`${part.name} dosyası açılamadı veya geçerli UTF-8 JSON içermiyor.`);
    }

    parseRelationships(value, part, records[part.kind]);
  }

  for (const kind of ["pending", "following"] as const) {
    if (listParts.some((part) => part.kind === kind)) {
      result[kind] = [...records[kind].values()].sort((a, b) => a.username.localeCompare(b.username));
    }
  }
  result.archiveAt = await findArchiveTime(sources, listParts[0].folder);
  return result;
}

export async function parseArchive(files: File[]): Promise<ParsedArchive> {
  const zipFiles = files.filter((file) => /\.zip$/i.test(file.name));
  if (zipFiles.length) {
    if (files.length !== 1) fail("Tek bir ZIP veya aynı arşive ait JSON dosyalarını seç.");
    return parseZip(zipFiles[0]);
  }

  const sources: Source[] = [];
  for (const file of files) {
    const part = identifyPath(file.name);
    if (!part) continue;
    sources.push({
      part,
      size: file.size,
      read: async () => new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()),
    });
  }
  return parseSources(sources);
}
