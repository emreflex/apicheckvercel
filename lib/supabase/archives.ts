import type { SupabaseClient } from "@supabase/supabase-js";
import type { ArchiveRecord, ArchiveSnapshot } from "@/lib/domain";

interface SnapshotRow {
  id: string;
  archive_at: string;
  uploaded_at: string;
  pending: ArchiveRecord[] | null;
  following: ArchiveRecord[] | null;
}

export async function* iterateSnapshots(supabase: SupabaseClient): AsyncGenerator<ArchiveSnapshot> {
  let cursor: SnapshotRow | undefined;

  while (true) {
    const { data, error } = await supabase.rpc("get_archive_snapshots", {
      p_before_archive_at: cursor?.archive_at ?? null,
      p_before_id: cursor?.id ?? null,
    });
    if (error) throw error;

    const page = data as SnapshotRow[];
    if (!page.length) return;

    for (const row of page) {
      yield {
        id: row.id,
        archiveAt: new Date(row.archive_at).toISOString(),
        uploadedAt: new Date(row.uploaded_at).toISOString(),
        pending: row.pending,
        following: row.following,
      };
    }
    cursor = page.at(-1);
  }
}

export async function getSnapshots(supabase: SupabaseClient): Promise<ArchiveSnapshot[]> {
  const snapshots: ArchiveSnapshot[] = [];
  for await (const snapshot of iterateSnapshots(supabase)) snapshots.push(snapshot);
  return snapshots;
}
