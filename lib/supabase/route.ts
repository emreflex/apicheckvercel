import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { createClient, getOwner } from "./server";
import { getSupabaseConfig } from "./config";

const MAX_BODY_BYTES = 32_768;

export class RequestError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function ownerRoute(action: (supabase: SupabaseClient) => Promise<Response>) {
  try {
    if (!getSupabaseConfig()) {
      throw new RequestError("Supabase bağlantısı yapılandırılmadı.", 503);
    }

    const supabase = await createClient();
    if (!(await getOwner(supabase))) {
      throw new RequestError("Bu işlem için yetkili hesapla giriş yapın.", 401);
    }
    return await action(supabase);
  } catch (error) {
    if (error instanceof RequestError) return json({ error: error.message }, error.status);
    console.error("Arşiv isteği tamamlanamadı.", errorCode(error));
    return json({ error: "İşlem tamamlanamadı. Lütfen tekrar deneyin." }, 500);
  }
}

export function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RequestError("Geçerli bir JSON nesnesi gönderin.");
  }
  return value as Record<string, unknown>;
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (contentType !== "application/json" || !request.body) {
    throw new RequestError("Geçerli bir JSON isteği gönderin.", 415);
  }

  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) {
    throw new RequestError("Kayıt grubu çok büyük.", 413);
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) throw new RequestError("Kayıt grubu çok büyük.", 413);
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return objectValue(JSON.parse(text));
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError("İstek gövdesi geçerli JSON içermiyor.");
  } finally {
    if (bytes > MAX_BODY_BYTES) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export function uuid(value: unknown): string {
  if (typeof value !== "string" || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value)) {
    throw new RequestError("Yükleme kimliği geçersiz.");
  }
  return value;
}

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return "unknown";
}

export function checkWrite(error: PostgrestError | null): void {
  if (!error) return;

  switch (error.code) {
    case "22023":
      throw new RequestError(error.message);
    case "23505":
      throw new RequestError("Gönderilen kayıtlar bu arşivdeki verilerle çakışıyor.", 409);
    case "P0002":
      throw new RequestError("Yükleme bulunamadı.", 404);
    case "42501":
      throw new RequestError("Bu işlem için yetkiniz yok.", 403);
    default:
      throw error;
  }
}
