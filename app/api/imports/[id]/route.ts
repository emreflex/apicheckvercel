import { BATCH_SIZE, type ArchiveRecord } from "@/lib/domain";
import {
  checkWrite, json, objectValue, ownerRoute, readJson, RequestError, uuid,
} from "@/lib/supabase/route";

type Context = { params: Promise<{ id: string }> };

function archiveRecord(value: unknown): ArchiveRecord {
  const { username, timestamp } = objectValue(value);

  if (typeof username !== "string" || !/^[a-z0-9._]{1,30}$/.test(username)) {
    throw new RequestError("Arşivde geçersiz bir Instagram kullanıcı adı var.");
  }
  if (
    timestamp !== null &&
    (typeof timestamp !== "number" || !Number.isInteger(timestamp) || timestamp < 0 || timestamp > 253_402_300_799)
  ) {
    throw new RequestError("Arşivde geçersiz bir kayıt tarihi var.");
  }

  return { username, timestamp };
}

export function PUT(request: Request, { params }: Context) {
  return ownerRoute(async (supabase) => {
    const id = uuid((await params).id);
    const { kind, offset, records } = await readJson(request);

    if (kind !== "pending" && kind !== "following") throw new RequestError("Liste türü geçersiz.");
    if (typeof offset !== "number" || !Number.isInteger(offset) || offset < 0 || offset >= 100_000) {
      throw new RequestError("Kayıt grubunun başlangıç konumu geçersiz.");
    }
    if (!Array.isArray(records) || records.length < 1 || records.length > BATCH_SIZE) {
      throw new RequestError(`Her grupta 1 ila ${BATCH_SIZE} kayıt olmalı.`);
    }

    const { error } = await supabase.rpc("append_archive_records", {
      p_id: id,
      p_kind: kind,
      p_offset: offset,
      p_records: records.map(archiveRecord),
    });
    checkWrite(error);
    return json({ id });
  });
}

export function POST(_request: Request, { params }: Context) {
  return ownerRoute(async (supabase) => {
    const id = uuid((await params).id);
    const { data, error } = await supabase.rpc("finish_archive_import", { p_id: id });
    checkWrite(error);
    return json(data);
  });
}
