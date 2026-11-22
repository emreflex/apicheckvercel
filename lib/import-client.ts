import { BATCH_SIZE, type ArchiveRecord, type ArchiveSnapshot, type ImportResult } from "./domain";

async function api<T>(path: string, method: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    cache: "no-store",
    ...(body === undefined ? {} : {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok || !payload) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("Oturum doğrulanamadı. Yeniden giriş yap.");
    }
    const message = typeof payload?.error === "string" ? payload.error : null;
    throw new Error(message ?? "Sunucuyla bağlantı kurulamadı. Yeniden dene.");
  }

  return payload as T;
}

interface ImportInput {
  archiveAt: string;
  pending: ArchiveRecord[] | null;
  following: ArchiveRecord[] | null;
}

export async function uploadImport(
  id: string,
  input: ImportInput,
  onProgress: (sent: number, total: number) => void,
): Promise<{ snapshots: ArchiveSnapshot[]; result: ImportResult }> {
  const { archiveAt, pending, following } = input;
  const total = (pending?.length ?? 0) + (following?.length ?? 0);
  await api("/api/imports", "POST", {
    id,
    archiveAt,
    pendingCount: pending?.length ?? null,
    followingCount: following?.length ?? null,
  });

  let sent = 0;
  onProgress(sent, total);
  for (const [kind, records] of [["pending", pending], ["following", following]] as const) {
    if (!records) continue;
    for (let offset = 0; offset < records.length; offset += BATCH_SIZE) {
      const batch = records.slice(offset, offset + BATCH_SIZE);
      await api(`/api/imports/${id}`, "PUT", { kind, offset, records: batch });
      sent += batch.length;
      onProgress(sent, total);
    }
  }

  const result = await api<ImportResult>(`/api/imports/${id}`, "POST");
  const { snapshots } = await api<{ snapshots: ArchiveSnapshot[] }>("/api/snapshots", "GET");
  return { snapshots, result };
}
