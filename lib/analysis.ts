import { ISTANBUL_TIME_ZONE, type ArchiveRecord, type ArchiveSnapshot } from "./domain";

export type RequestStatus = "pending" | "accepted" | "uncertain";

export interface RequestChange {
  archiveId: string;
  username: string;
  status: RequestStatus;
  at: string;
  sentAt: number | null;
  observedFrom: string | null;
}

export interface RequestHistoryEntry extends RequestChange {
  kind: "change" | "verification" | "insufficient";
}

export interface RequestRow {
  username: string;
  status: RequestStatus;
  at: string;
  sentAt: number | null;
  observedFrom: string | null;
  insufficientAt: string | null;
  history: RequestHistoryEntry[];
}

export interface ArchiveAnalysis {
  rows: RequestRow[];
  changes: RequestChange[];
  latestArchiveAt: string | null;
  latestUploadAt: string | null;
  latestPendingAt: string | null;
  pendingCount: number | null;
}

interface RequestState {
  row: RequestRow;
  lastPendingAt: string;
}

interface ArchiveObservation extends ArchiveSnapshot {
  conflictingPendingUsers: ReadonlySet<string>;
}

function mergeLists(lists: (ArchiveRecord[] | null)[]): ArchiveRecord[] | null {
  const present = lists.filter((list) => list !== null);
  if (present.length < 2) return present[0] ?? null;

  const timestamps = new Map(present[0].map(({ username, timestamp }) => [username, timestamp]));
  const conflicts = new Set<string>();
  for (const list of present.slice(1)) {
    if (list.length !== timestamps.size) return null;
    for (const { username, timestamp } of list) {
      const prior = timestamps.get(username);
      if (prior === undefined) return null;
      if (timestamp === null || conflicts.has(username)) continue;
      if (prior === null || prior === timestamp) {
        timestamps.set(username, timestamp);
      } else {
        timestamps.set(username, null);
        conflicts.add(username);
      }
    }
  }
  return Array.from(timestamps, ([username, timestamp]) => ({ username, timestamp }));
}

function groupObservations(snapshots: ArchiveSnapshot[]): ArchiveObservation[] {
  const byInstant = new Map<number, ArchiveSnapshot[]>();
  for (const snapshot of snapshots) {
    const instant = Date.parse(snapshot.archiveAt);
    const group = byInstant.get(instant);
    if (group) group.push(snapshot);
    else byInstant.set(instant, [snapshot]);
  }
  return [...byInstant.entries()].sort(([a], [b]) => a - b).map(([instant, group]) => {
    const latest = group.reduce((earlier, later) => {
      const uploadDifference = Date.parse(later.uploadedAt) - Date.parse(earlier.uploadedAt);
      return uploadDifference > 0 || (uploadDifference === 0 && later.id > earlier.id) ? later : earlier;
    });
    const pendingLists = group.map((snapshot) => snapshot.pending);
    const pending = mergeLists(pendingLists);
    // Aynı ana ait dosyalar gözlemleri tamamlayabilir. Çelişen listelerden durum çıkarılmaz.
    return {
      ...latest,
      archiveAt: new Date(instant).toISOString(),
      pending,
      following: mergeLists(group.map((snapshot) => snapshot.following)),
      conflictingPendingUsers: new Set(pending === null
        ? pendingLists.flatMap((list) => list?.map(({ username }) => username) ?? [])
        : []),
    };
  });
}

function recordObservation(
  row: RequestRow,
  archive: ArchiveSnapshot,
  kind: RequestHistoryEntry["kind"],
  changes: RequestChange[],
) {
  const { username, status, sentAt, observedFrom } = row;
  const event = { archiveId: archive.id, username, status, sentAt, observedFrom, at: archive.archiveAt };
  row.history.push({ ...event, kind });
  if (kind === "change") changes.push(event);
}

export function analyzeArchives(snapshots: ArchiveSnapshot[]): ArchiveAnalysis {
  const accounts = new Map<string, RequestState>();
  const changes: RequestChange[] = [];
  const observations = groupObservations(snapshots);
  let latestPendingAt: string | null = null;
  let pendingCount: number | null = null;

  for (const archive of observations) {
    const at = archive.archiveAt;
    const pendingUsers = new Set<string>();

    for (const { username, timestamp } of archive.pending ?? []) {
      pendingUsers.add(username);
      const previous = accounts.get(username);
      const existingRequest = previous?.row.status === "pending";
      const sentAt = existingRequest ? timestamp ?? previous.row.sentAt : timestamp;
      const row: RequestRow = {
        username,
        status: "pending",
        at,
        sentAt,
        observedFrom: null,
        insufficientAt: null,
        history: previous?.row.history ?? [],
      };
      accounts.set(username, { row, lastPendingAt: at });
      recordObservation(row, archive, existingRequest ? "verification" : "change", changes);
    }

    if (archive.pending !== null) {
      latestPendingAt = at;
      pendingCount = pendingUsers.size;
    }

    const followingUsers = archive.following && new Set(archive.following.map(({ username }) => username));

    for (const { row, lastPendingAt } of accounts.values()) {
      if (pendingUsers.has(row.username) || row.status === "accepted") continue;
      const accepted = followingUsers?.has(row.username) && !archive.conflictingPendingUsers.has(row.username);
      if (!accepted && (archive.pending === null || followingUsers === null)) {
        row.insufficientAt = at;
        recordObservation(row, archive, "insufficient", changes);
        continue;
      }

      const status = accepted ? "accepted" : "uncertain";
      const kind = row.status === status ? "verification" : "change";
      row.status = status;
      row.at = at;
      row.observedFrom = status === "accepted" ? lastPendingAt : null;
      row.insufficientAt = null;
      recordObservation(row, archive, kind, changes);
    }
  }

  const latestUploadAt = snapshots.reduce<string | null>((latest, { uploadedAt }) =>
    latest === null || Date.parse(uploadedAt) > Date.parse(latest) ? uploadedAt : latest,
    null,
  );

  return {
    rows: [...accounts.values()].map(({ row }) => row).sort((a, b) =>
      Date.parse(b.at) - Date.parse(a.at) || a.username.localeCompare(b.username),
    ),
    changes,
    latestArchiveAt: observations.at(-1)?.archiveAt ?? null,
    latestUploadAt,
    latestPendingAt,
    pendingCount,
  };
}

const istanbulDay = new Intl.DateTimeFormat("en-GB", {
  timeZone: ISTANBUL_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function inPeriod(startDate?: string, endDate?: string) {
  const days = new Map<string, string>();
  return (date: string) => {
    if (!startDate && !endDate) return true;
    let day = days.get(date);
    if (day === undefined) {
      const parts = istanbulDay.formatToParts(new Date(date));
      const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
      day = `${get("year")}-${get("month")}-${get("day")}`;
      days.set(date, day);
    }
    return (!startDate || day >= startDate) && (!endDate || day <= endDate);
  };
}

export function getPeriodCounts(analysis: ArchiveAnalysis, startDate?: string, endDate?: string) {
  const matchesDate = inPeriod(startDate, endDate);
  const accepted = new Set<string>();
  const uncertain = new Set<string>();
  for (const event of analysis.changes) {
    if (!matchesDate(event.at)) continue;
    if (event.status === "accepted") accepted.add(event.username);
    if (event.status === "uncertain") uncertain.add(event.username);
  }
  return { pending: analysis.pendingCount, accepted: accepted.size, uncertain: uncertain.size };
}

export interface RequestFilters {
  query?: string;
  status?: RequestStatus | "insufficient" | "all";
  startDate?: string;
  endDate?: string;
}

export function filterRequestRows(analysis: ArchiveAnalysis, filters: RequestFilters = {}): RequestRow[] {
  const { status = "all", startDate, endDate } = filters;
  const query = filters.query?.trim().replace(/^@/, "").toLowerCase() ?? "";
  const matchesDate = inPeriod(startDate, endDate);
  return analysis.rows.filter((row) => {
    if (!row.username.toLowerCase().includes(query)) return false;
    if (status === "insufficient" && row.insufficientAt === null) return false;
    if (status !== "all" && status !== "insufficient" && row.status !== status) return false;
    if (!startDate && !endDate) return true;
    return row.history.some((event) => {
      if (status === "insufficient") return event.kind === "insufficient" && matchesDate(event.at);
      if (status !== "all") return event.kind !== "insufficient" && event.status === status && matchesDate(event.at);
      return matchesDate(event.at);
    });
  });
}
