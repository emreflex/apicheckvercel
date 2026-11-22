export interface ArchiveRecord {
  username: string;
  timestamp: number | null;
}

export interface ArchiveSnapshot {
  id: string;
  archiveAt: string;
  uploadedAt: string;
  pending: ArchiveRecord[] | null;
  following: ArchiveRecord[] | null;
}

export type ListKind = "pending" | "following";
export const BATCH_SIZE = 250;

export interface ImportResult {
  id: string;
  duplicate: boolean;
}

export const ISTANBUL_TIME_ZONE = "Europe/Istanbul";
