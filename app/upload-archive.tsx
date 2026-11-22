"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Archive, FileCheck2, UploadCloud, X } from "lucide-react";
import { ISTANBUL_TIME_ZONE, type ArchiveSnapshot, type ImportResult } from "@/lib/domain";
import { uploadImport } from "@/lib/import-client";
import { fromIstanbulDate } from "@/lib/istanbul";

type ParsedArchive = Awaited<ReturnType<typeof import("@/lib/archive").parseArchive>>;

interface UploadCallbacks {
  onClose: () => void;
  onUploaded: (snapshots: ArchiveSnapshot[], result: ImportResult) => void;
}

const number = new Intl.NumberFormat("tr-TR");
const archiveDate = new Intl.DateTimeFormat("tr-TR", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: ISTANBUL_TIME_ZONE,
});

function UploadDialog({ onClose, onUploaded }: UploadCallbacks) {
  const dialog = useRef<HTMLDialogElement>(null);
  const fileField = useRef<HTMLInputElement>(null);
  const importAttempt = useRef<{ archiveAt: string; id: string } | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [parsed, setParsed] = useState<ParsedArchive | null>(null);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => element?.close();
  }, []);

  function reset() {
    setParsed(null);
    setFiles([]);
    setConfirmed(false);
    setDate("");
    setTime("");
    setError("");
    importAttempt.current = null;
    if (fileField.current) fileField.current.value = "";
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError("");

    if (!parsed) {
      if (!files.length) return;
      setBusy(true);
      setProgress("Dosyalar tarayıcıda inceleniyor…");

      try {
        const { parseArchive } = await import("@/lib/archive");
        setParsed(await parseArchive(files));
      } catch (problem) {
        setError(problem instanceof Error ? problem.message : "Arşiv okunamadı.");
      } finally {
        setBusy(false);
        setProgress("");
      }
      return;
    }

    if (!confirmed) return;
    const archiveAt = parsed.archiveAt ?? fromIstanbulDate(date, time || "00:00");
    if (!archiveAt || Date.parse(archiveAt) > Date.now()) {
      setError("Geçerli bir arşiv tarihi gir. Arşiv tarihi gelecekte olamaz.");
      return;
    }

    if (importAttempt.current?.archiveAt !== archiveAt) {
      importAttempt.current = { archiveAt, id: crypto.randomUUID() };
    }
    setBusy(true);
    setProgress("Yükleme hazırlanıyor…");

    try {
      const { snapshots, result } = await uploadImport(importAttempt.current.id, {
        archiveAt,
        pending: parsed.pending,
        following: parsed.following,
      }, (sent, total) => {
        setProgress(sent === total
          ? "Arşiv kaydediliyor…"
          : `${number.format(sent)} / ${number.format(total)} kayıt gönderildi…`);
      });
      onUploaded(snapshots, result);
      onClose();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Yükleme tamamlanamadı. Yeniden dene.");
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  return (
    <dialog
      ref={dialog}
      className="upload-dialog"
      aria-labelledby="upload-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="upload-heading">
        <span className="upload-symbol"><Archive size={22} aria-hidden="true" /></span>
        <button type="button" className="upload-close" onClick={onClose} disabled={busy} aria-label="Kapat">
          <X size={21} aria-hidden="true" />
        </button>
      </div>
      <h2 id="upload-title">Instagram arşivi yükle</h2>
      <p>Instagram’dan JSON biçiminde indirdiğin ZIP arşivini veya ilgili JSON dosyalarını seç.</p>

      <form className="upload-form" onSubmit={submit}>
        {!parsed ? (
          <label className="upload-file">
            <UploadCloud size={27} aria-hidden="true" />
            <span>{files.length ? `${files.length} dosya seçildi` : "ZIP veya JSON dosyalarını seç"}</span>
            <input
              ref={fileField}
              type="file"
              accept=".zip,.json"
              multiple
              required
              disabled={busy}
              onChange={(event) => {
                setFiles(Array.from(event.target.files ?? []));
                setError("");
              }}
            />
          </label>
        ) : (
          <>
            <div className="upload-found">
              <FileCheck2 size={22} aria-hidden="true" />
              <dl>
                <div><dt>Bekleyen istekler</dt><dd>{parsed.pending === null ? "Dosya eksik" : `${number.format(parsed.pending.length)} kayıt`}</dd></div>
                <div><dt>Takip edilenler</dt><dd>{parsed.following === null ? "Dosya eksik" : `${number.format(parsed.following.length)} kayıt`}</dd></div>
              </dl>
            </div>
            {(parsed.pending === null || parsed.following === null) && (
              <p className="upload-note">Eksik liste gerektiren durum değişiklikleri doğrulanamayabilir.</p>
            )}
            {parsed.archiveAt ? (
              <p className="upload-note">Arşiv tarihi <strong>{archiveDate.format(new Date(parsed.archiveAt))}</strong></p>
            ) : (
              <>
                <div className="upload-dates">
                  <label>Arşivin oluşturulduğu tarih<input type="date" min="2010-10-06" value={date} required disabled={busy} onChange={(event) => setDate(event.target.value)} /></label>
                  <label>Saat (isteğe bağlı)<input type="time" value={time} disabled={busy} onChange={(event) => setTime(event.target.value)} /></label>
                </div>
                <p className="upload-note">İstanbul saati kullanılır. Saat girmezsen arşiv seçtiğin günün başına yerleştirilir.</p>
              </>
            )}
            <label className="upload-confirm">
              <input type="checkbox" required checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} />
              <span>Dışa aktarma zaman aralığı “Tüm zamanlar”. Seçtiğim her listenin bütün parçaları aynı arşivden.</span>
            </label>
          </>
        )}

        {error && <p className="form-error" role="alert">{error}</p>}
        <p className="upload-note" role="status">{progress || "Yalnızca kullanıcı adları, varsa kaynak zamanları ve arşiv tarihi kaydedilir."}</p>

        <div className="upload-actions">
          <button type="button" className="upload-secondary" disabled={busy} onClick={parsed ? reset : onClose}>
            {parsed ? "Dosyaları değiştir" : "Vazgeç"}
          </button>
          <button type="submit" className="action-primary" disabled={busy || (parsed ? !confirmed : !files.length)}>
            {busy ? "İşleniyor…" : parsed ? "Arşivi kaydet" : "Dosyaları incele"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

export default function UploadArchive({ open, ...callbacks }: UploadCallbacks & { open: boolean }) {
  return open ? <UploadDialog {...callbacks} /> : null;
}
