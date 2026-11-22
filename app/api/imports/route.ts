import { checkWrite, json, ownerRoute, readJson, RequestError, uuid } from "@/lib/supabase/route";

function count(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 100_000) {
    throw new RequestError("Arşivdeki liste boyutu geçersiz.");
  }
  return value;
}

function isoTimestamp(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value)
  ) {
    throw new RequestError("Arşiv tarihini saat dilimiyle birlikte girin.");
  }
  const date = new Date(value);
  const wallClock = new Date(`${value.slice(0, 19)}Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    !Number.isFinite(wallClock.getTime()) ||
    wallClock.toISOString().slice(0, 19) !== value.slice(0, 19) ||
    date.getUTCFullYear() < 1 ||
    date.getUTCFullYear() > 9999
  ) {
    throw new RequestError("Arşiv tarihi geçersiz.");
  }
  return date.toISOString();
}

export function POST(request: Request) {
  return ownerRoute(async (supabase) => {
    const body = await readJson(request);
    const id = uuid(body.id);
    const archiveAt = isoTimestamp(body.archiveAt);
    const pendingCount = count(body.pendingCount);
    const followingCount = count(body.followingCount);

    if (pendingCount === null && followingCount === null) {
      throw new RequestError("Yüklemek için en az bir takip listesi gerekli.");
    }

    const { error } = await supabase.rpc("begin_archive_import", {
      p_id: id,
      p_archive_at: archiveAt,
      p_pending_count: pendingCount,
      p_following_count: followingCount,
    });
    checkWrite(error);
    return json({ id });
  });
}
