"use client";

import {
  Archive, ArrowDownToLine, ArrowRight, CalendarDays, ChevronDown, ChevronLeft,
  ChevronRight, CircleHelp, Clock3, FolderOpen, History, LayoutDashboard, List,
  LockKeyhole, LogOut, Search, UploadCloud, UserRoundCheck, X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { signOut } from "@/app/auth/actions";
import UploadArchive from "@/app/upload-archive";
import {
  analyzeArchives, filterRequestRows, getPeriodCounts,
  type ArchiveAnalysis, type RequestChange, type RequestRow, type RequestStatus,
} from "@/lib/analysis";
import { ISTANBUL_TIME_ZONE, type ArchiveSnapshot, type ImportResult } from "@/lib/domain";

const dateOptions = { timeZone: ISTANBUL_TIME_ZONE };
const dayFormatter = new Intl.DateTimeFormat("tr-TR", { ...dateOptions, day: "numeric", month: "short", year: "numeric" });
const timeFormatter = new Intl.DateTimeFormat("tr-TR", { ...dateOptions, hour: "2-digit", minute: "2-digit" });
const numberFormatter = new Intl.NumberFormat("tr-TR");
const pageSize = 15;

const statuses = {
  pending: { title: "Bekleyen", short: "Bekliyor", icon: Clock3 },
  accepted: { title: "Kabul edildiği gözlenen", short: "Kabul gözlendi", icon: UserRoundCheck },
  uncertain: { title: "Sonucu belirsiz", short: "Sonucu belirsiz", icon: CircleHelp },
} as const;

type FilterStatus = RequestStatus | "insufficient" | "all";

function formatDay(value: string | number) {
  return dayFormatter.format(new Date(value));
}

function formatDate(value: string | number) {
  const date = new Date(value);
  return `${dayFormatter.format(date)} · ${timeFormatter.format(date)}`;
}

function statusDate(row: RequestRow) {
  if (row.status === "accepted" && row.observedFrom) {
    const from = formatDay(row.observedFrom);
    const to = formatDay(row.at);
    return from === to ? `${from} · ${timeFormatter.format(new Date(row.observedFrom))} – ${timeFormatter.format(new Date(row.at))}` : `${from} – ${to}`;
  }

  return formatDay(row.at);
}

function displayRange(startDate: string, endDate: string) {
  if (startDate && endDate) return `${formatDay(`${startDate}T12:00:00Z`)} – ${formatDay(`${endDate}T12:00:00Z`)}`;
  if (startDate) return `${formatDay(`${startDate}T12:00:00Z`)} sonrası`;
  if (endDate) return `${formatDay(`${endDate}T12:00:00Z`)} öncesi`;
  return "Tüm tarihler";
}

function avatarStyle(username: string) {
  return [...username].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 5;
}

function StatusBadge({ status }: { status: RequestStatus }) {
  return <span className={`status-badge ${status}`}><span />{statuses[status].short}</span>;
}

function StatCard({ status, value, detail }: { status: RequestStatus; value: number | null; detail: string }) {
  const meta = statuses[status];
  const Icon = meta.icon;
  return (
    <section className={`stat-card ${status}`} aria-label={meta.title}>
      <span className="stat-icon"><Icon size={20} strokeWidth={1.9} aria-hidden="true" /></span>
      <div className="stat-label">{meta.title}</div>
      <div className="stat-value" aria-label={value === null ? "Veri yetersiz" : undefined}>
        {value === null ? "—" : numberFormatter.format(value)}
      </div>
      <p>{detail}</p>
    </section>
  );
}

function RequestDetails({ row, onClose }: { row: RequestRow; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  return (
    <dialog
      ref={dialog}
      className="request-drawer"
      aria-labelledby="request-details-title"
      onClose={onClose}
      onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }}
    >
      <div className="request-drawer-content">
        <div className="drawer-top">
          <span><History size={17} aria-hidden="true" /> İstek geçmişi</span>
          <button type="button" className="icon-button" onClick={() => dialog.current?.close()} aria-label="Geçmişi kapat">
            <X size={19} aria-hidden="true" />
          </button>
        </div>
        <header className="drawer-profile">
          <span className={`profile-avatar color-${avatarStyle(row.username)}`} aria-hidden="true">{row.username.slice(0, 2).toUpperCase()}</span>
          <div>
            <h2 id="request-details-title">@{row.username}</h2>
            <StatusBadge status={row.status} />
          </div>
        </header>
        <div className="drawer-facts">
          <div><span>İstek tarihi</span><strong>{row.sentAt === null ? "Kaynakta belirtilmemiş" : formatDate(row.sentAt * 1000)}</strong></div>
          <div><span>Son doğrulama</span><strong>{formatDate(row.at)}</strong></div>
          {row.status === "accepted" && row.observedFrom && (
            <div><span>Kabul gözlem aralığı</span><strong>{formatDate(row.observedFrom)} – {formatDate(row.at)}</strong></div>
          )}
        </div>
        {row.insufficientAt && (
          <p className="drawer-note"><CircleHelp size={17} aria-hidden="true" /> {formatDate(row.insufficientAt)} arşivinde karşılaştırma için veri yetersiz. Son doğrulanan durum gösteriliyor.</p>
        )}
        <h3 className="timeline-heading">Zaman çizelgesi</h3>
        <ol className="timeline-list">
          {[...row.history].reverse().map((event, index) => (
            <li key={`${event.archiveId}-${event.kind}-${index}`}>
              <span className={`timeline-dot ${event.kind === "insufficient" ? "insufficient" : event.status}`} />
              <div>
                <time dateTime={event.at}>{formatDate(event.at)}</time>
                <strong>{event.kind === "insufficient" ? "Veri yetersiz" : statuses[event.status].title}</strong>
                {event.kind === "verification" && <p>Durum arşivde doğrulandı.</p>}
                {event.kind === "insufficient" && <p>Karşılaştırma için gereken liste eksik.</p>}
                {event.kind === "change" && event.status === "accepted" && event.observedFrom && (
                  <p>{formatDate(event.observedFrom)} – {formatDate(event.at)}</p>
                )}
                {event.kind === "change" && event.status === "uncertain" && <p>Hesap bekleyen istekler ve takip edilenler listelerinde görünmüyor.</p>}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </dialog>
  );
}

type UploadSummaryData = {
  duplicate: boolean;
  archiveAt?: string;
  names: Record<RequestStatus | "revised", string[]>;
};

function changeKey(change: RequestChange) {
  return JSON.stringify([change.username, change.status, change.at]);
}

function summarizeUpload(before: ArchiveAnalysis, after: ArchiveAnalysis, duplicate: boolean, archiveAt?: string): UploadSummaryData {
  const names: UploadSummaryData["names"] = { pending: [], accepted: [], uncertain: [], revised: [] };
  if (duplicate) return { duplicate, archiveAt, names };

  const previous = new Map(before.changes.map((change) => [changeKey(change), change]));
  const current = new Set<string>();
  for (const change of after.changes) {
    const key = changeKey(change);
    current.add(key);
    const existing = previous.get(key);
    if (!existing) names[change.status].push(change.username);
    else if (existing.observedFrom !== change.observedFrom || existing.sentAt !== change.sentAt) names.revised.push(change.username);
  }
  for (const [key, change] of previous) {
    if (!current.has(key)) names.revised.push(change.username);
  }
  for (const status of ["pending", "accepted", "uncertain", "revised"] as const) {
    names[status] = [...new Set(names[status])].sort();
  }
  return { duplicate, archiveAt, names };
}

function UploadSummary({ data, onDismiss }: { data: UploadSummaryData; onDismiss: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [visibleCount, setVisibleCount] = useState(24);
  const groups = [
    ["pending", "Bekleyen istek kaydı eklendi"],
    ["accepted", "Kabul gözlemi eklendi"],
    ["uncertain", "Belirsiz sonuç kaydı eklendi"],
    ["revised", "Geçmiş kaydı güncellendi"],
  ] as const;
  const hasChanges = Object.values(data.names).some((names) => names.length > 0);
  const hasMore = Object.values(data.names).some((names) => names.length > visibleCount);

  return (
    <aside className="upload-summary" aria-label="Arşiv yükleme özeti">
      <span className="summary-icon"><Archive size={19} aria-hidden="true" /></span>
      <div className="summary-body">
        <div role="status">
          <strong>{data.duplicate ? "Bu arşiv zaten kayıtlı" : "Arşiv analizi güncellendi"}</strong>
          <p>{data.duplicate ? "Sayaçlar ve geçmiş aynı kaldı." : [data.archiveAt && formatDate(data.archiveAt), !hasChanges && "Yeni durum değişikliği bulunmadı."].filter(Boolean).join(" · ")}</p>
        </div>
        {hasChanges && (
          <div className="summary-groups">
            {groups.map(([key, label]) => {
              const names = data.names[key];
              if (names.length === 0) return null;
              return (
                <div key={key} className="summary-group">
                  <span>{label} <strong>({numberFormatter.format(names.length)})</strong></span>
                  <div>{names.slice(0, expanded ? visibleCount : 6).map((name) => <span className="summary-username" key={name}>@{name}</span>)}</div>
                </div>
              );
            })}
            {!expanded && Object.values(data.names).some((names) => names.length > 6) && (
              <button className="text-button" type="button" onClick={() => setExpanded(true)}>Daha fazla kullanıcı adı göster</button>
            )}
            {expanded && hasMore && (
              <button className="text-button" type="button" onClick={() => setVisibleCount((count) => count + 24)}>Daha fazla kullanıcı adı göster</button>
            )}
          </div>
        )}
      </div>
      <button type="button" className="icon-button" onClick={onDismiss} aria-label="Yükleme özetini kapat"><X size={18} aria-hidden="true" /></button>
    </aside>
  );
}

export default function Dashboard({ initialSnapshots, email }: { initialSnapshots: ArchiveSnapshot[]; email: string }) {
  const [snapshots, setSnapshots] = useState(initialSnapshots);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadSummary, setUploadSummary] = useState<{ data: UploadSummaryData; key: number } | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<FilterStatus>("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [page, setPage] = useState(1);
  const [selectedUsername, setSelectedUsername] = useState<string | null>(null);
  const dateDetails = useRef<HTMLDetailsElement>(null);

  const analysis = useMemo(() => analyzeArchives(snapshots), [snapshots]);
  const rows = useMemo(() => filterRequestRows(analysis, { query, status, startDate, endDate }), [analysis, query, status, startDate, endDate]);
  const counts = useMemo(() => getPeriodCounts(analysis, startDate, endDate), [analysis, startDate, endDate]);
  const lastPage = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, lastPage);
  const offset = (currentPage - 1) * pageSize;
  const pageRows = rows.slice(offset, offset + pageSize);
  const selectedRow = analysis.rows.find((row) => row.username === selectedUsername);
  const hasFilters = Boolean(query || status !== "all" || startDate || endDate);
  const latestUpload = snapshots.find((snapshot) => snapshot.uploadedAt === analysis.latestUploadAt);
  const pendingDetail = analysis.latestPendingAt ? `${formatDay(analysis.latestPendingAt)} tarihli liste` : "Bekleyen istekler listesi gerekli";
  const periodDetail = startDate || endDate ? "Seçilen tarih aralığında" : "Tüm arşivlerdeki değişimler";

  function resetFilters() {
    setQuery("");
    setStatus("all");
    setStartDate("");
    setEndDate("");
    setPage(1);
  }

  function uploaded(next: ArchiveSnapshot[], result: ImportResult) {
    const archiveAt = next.find((snapshot) => snapshot.id === result.id)?.archiveAt;
    setUploadSummary({ data: summarizeUpload(analysis, analyzeArchives(next), result.duplicate, archiveAt), key: Date.now() });
    setSnapshots(next);
    setPage(1);
    setUploadOpen(false);
  }

  return (
    <div className="dashboard-shell" id="overview">
      <aside className="sidebar" aria-label="Panel gezinmesi">
        <a className="brand" href="#overview">
          <span className="brand-mark"><History size={22} strokeWidth={2.2} aria-hidden="true" /></span>
          <span>Takip Defteri</span>
        </a>
        <nav className="sidebar-nav" aria-label="Panel bölümleri">
          <a className="nav-link nav-primary" href="#overview"><LayoutDashboard size={18} aria-hidden="true" /> Genel bakış</a>
          <a className="nav-link" href="#requests"><List size={18} aria-hidden="true" /> İstek geçmişi</a>
          <button type="button" className="nav-link" onClick={() => setUploadOpen(true)}><ArrowDownToLine size={18} aria-hidden="true" /> Arşiv yükle</button>
        </nav>
        <div className="sidebar-footer">
          <div className="privacy-label"><LockKeyhole size={15} aria-hidden="true" /> Özel çalışma alanı</div>
          <div className="account-line">
            <span className="account-avatar" aria-hidden="true">{email.slice(0, 2).toUpperCase()}</span>
            <span className="account-email" title={email}>{email}</span>
            <form action={signOut}>
              <button className="icon-button" type="submit" aria-label="Oturumu kapat"><LogOut size={17} aria-hidden="true" /></button>
            </form>
          </div>
        </div>
      </aside>

      <main className="dashboard-main">
        <div className="dashboard-content">
          <header className="dashboard-heading">
            <div><h1>Takip istekleri</h1><p>Gönderdiğin istekleri ve arşivler arasındaki değişimleri izle.</p></div>
            <button className="button button-primary" type="button" onClick={() => setUploadOpen(true)}><UploadCloud size={18} aria-hidden="true" /> Arşiv yükle</button>
          </header>

          <div className="archive-meta">
            <span className="archive-meta-icon"><CalendarDays size={16} aria-hidden="true" /></span>
            <span>Son yüklenen arşiv</span>
            <strong>{latestUpload ? <time dateTime={latestUpload.archiveAt}>{formatDate(latestUpload.archiveAt)}</time> : "Henüz yüklenmedi"}</strong>
            {latestUpload && <span className="archive-receipt">Yükleme zamanı <time dateTime={latestUpload.uploadedAt}>{formatDate(latestUpload.uploadedAt)}</time></span>}
          </div>

          <div className="stats-grid" aria-label="Takip isteği sayaçları">
            <StatCard status="pending" value={counts.pending} detail={pendingDetail} />
            <StatCard status="accepted" value={counts.accepted} detail={periodDetail} />
            <StatCard status="uncertain" value={counts.uncertain} detail={periodDetail} />
          </div>

          {uploadSummary && <UploadSummary key={uploadSummary.key} data={uploadSummary.data} onDismiss={() => setUploadSummary(null)} />}

          <section className="requests-card" id="requests" aria-labelledby="requests-title">
            <header className="requests-heading">
              <div><h2 id="requests-title">İstek geçmişi</h2><p>Bir hesabı seçerek durum değişimlerini incele.</p></div>
              <span className="result-count">{numberFormatter.format(rows.length)} hesap</span>
            </header>
            <div className="filter-bar">
              <label className="search-field">
                <Search size={18} aria-hidden="true" />
                <span className="visually-hidden">Kullanıcı adı ara</span>
                <input type="search" placeholder="Kullanıcı adı ara" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} />
              </label>
              <label className="status-filter">
                <span className="visually-hidden">Durum filtresi</span>
                <select value={status} onChange={(event) => { setStatus(event.target.value as FilterStatus); setPage(1); }}>
                  <option value="all">Tüm durumlar</option>
                  <option value="pending">Bekliyor</option>
                  <option value="accepted">Kabul edildiği gözlenen</option>
                  <option value="uncertain">Sonucu belirsiz</option>
                  <option value="insufficient">Veri yetersiz</option>
                </select>
                <ChevronDown size={15} aria-hidden="true" />
              </label>
              <details ref={dateDetails} className="date-filter">
                <summary title={displayRange(startDate, endDate)}><CalendarDays size={17} aria-hidden="true" /><span>{displayRange(startDate, endDate)}</span><ChevronDown size={15} aria-hidden="true" /></summary>
                <div className="date-panel">
                  <label>Başlangıç<input type="date" value={startDate} max={endDate || undefined} onChange={(event) => { setStartDate(event.target.value); setPage(1); }} /></label>
                  <label>Bitiş<input type="date" value={endDate} min={startDate || undefined} onChange={(event) => { setEndDate(event.target.value); setPage(1); }} /></label>
                  <div className="date-panel-actions">
                    <button type="button" className="text-button" onClick={() => { setStartDate(""); setEndDate(""); setPage(1); }}>Temizle</button>
                    <button type="button" className="button button-primary" onClick={() => { if (dateDetails.current) dateDetails.current.open = false; }}>Tamam</button>
                  </div>
                </div>
              </details>
            </div>

            <div className="table-layout">
              <table className="requests-table">
                <thead>
                  <tr><th scope="col">Kullanıcı adı</th><th scope="col">Durum</th><th scope="col">İstek tarihi</th><th scope="col">Gözlem tarihi</th><th scope="col"><span className="visually-hidden">Detaylar</span></th></tr>
                </thead>
                <tbody>
                  {pageRows.map((row) => (
                    <tr key={row.username}>
                      <th scope="row">
                        <button type="button" className="row-user" aria-haspopup="dialog" onClick={() => setSelectedUsername(row.username)}>
                          <span className={`profile-avatar color-${avatarStyle(row.username)}`} aria-hidden="true">{row.username.slice(0, 2).toUpperCase()}</span>
                          <span>@{row.username}</span>
                        </button>
                      </th>
                      <td><StatusBadge status={row.status} />{row.insufficientAt && <span className="insufficient-note">Veri yetersiz</span>}</td>
                      <td>{row.sentAt === null ? <span className="unknown-date">—</span> : formatDay(row.sentAt * 1000)}</td>
                      <td>{row.status === "accepted" && row.observedFrom ? <span>{statusDate(row)}</span> : <time dateTime={row.at}>{statusDate(row)}</time>}</td>
                      <td><button className="icon-button row-open" type="button" aria-label={`@${row.username} geçmişini aç`} aria-haspopup="dialog" onClick={() => setSelectedUsername(row.username)}><ChevronRight size={18} aria-hidden="true" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length === 0 && (
                <div className="empty-state">
                  <span className="empty-icon"><FolderOpen size={28} strokeWidth={1.65} aria-hidden="true" /></span>
                  <h3>{snapshots.length === 0 ? "Henüz arşiv yüklenmedi" : hasFilters ? "Eşleşen hesap bulunamadı" : "İstek kaydı bulunamadı"}</h3>
                  <p>{snapshots.length === 0 ? "İstek geçmişini görmek için Instagram JSON arşivini yükle." : hasFilters ? "Farklı bir kullanıcı adı, durum veya tarih aralığı dene." : analysis.latestPendingAt ? "Yüklenen arşivlerde bekleyen takip isteği gözlenmedi." : "Analiz için bekleyen istekler listesini içeren bir arşiv yükle."}</p>
                  {snapshots.length === 0 && <button type="button" className="button button-secondary" onClick={() => setUploadOpen(true)}>Arşiv yükle <ArrowRight size={16} aria-hidden="true" /></button>}
                  {snapshots.length > 0 && hasFilters && <button type="button" className="button button-secondary" onClick={resetFilters}>Filtreleri temizle</button>}
                </div>
              )}
            </div>

            {rows.length > 0 && (
              <div className="table-footer">
                <span>{numberFormatter.format(offset + 1)}–{numberFormatter.format(offset + pageRows.length)} / {numberFormatter.format(rows.length)} hesap</span>
                {lastPage > 1 && (
                  <div className="pagination" aria-label="Sayfa gezinmesi">
                    <button className="icon-button" type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} aria-label="Önceki sayfa"><ChevronLeft size={17} aria-hidden="true" /></button>
                    <span>{currentPage} / {lastPage}</span>
                    <button className="icon-button" type="button" disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)} aria-label="Sonraki sayfa"><ChevronRight size={17} aria-hidden="true" /></button>
                  </div>
                )}
              </div>
            )}
          </section>
          <footer className="dashboard-footer"><Clock3 size={14} aria-hidden="true" /> Saat dilimi {ISTANBUL_TIME_ZONE}</footer>
        </div>
      </main>

      {selectedRow && <RequestDetails key={selectedRow.username} row={selectedRow} onClose={() => setSelectedUsername(null)} />}
      <UploadArchive open={uploadOpen} onClose={() => setUploadOpen(false)} onUploaded={uploaded} />
    </div>
  );
}
