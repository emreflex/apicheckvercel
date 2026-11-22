import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getSupabaseConfig } from "./config";

export async function createClient() {
  const config = getSupabaseConfig();
  if (!config) throw new Error("Supabase ortam değişkenleri eksik.");

  const cookieStore = await cookies();
  return createServerClient(config.url, config.key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(values) {
        try {
          for (const { name, value, options } of values) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Oturum çerezlerini Server Component isteklerinde proxy yeniler.
        }
      },
    },
  });
}

export async function isOwner(supabase: SupabaseClient): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_app_owner");
  if (error) throw error;
  return data === true;
}

export async function getOwner(supabase?: SupabaseClient): Promise<User | null> {
  const client = supabase ?? (await createClient());
  const { data, error } = await client.auth.getUser();
  if (error && error.name !== "AuthSessionMissingError" && (!error.status || error.status >= 500)) {
    throw error;
  }

  return data.user && (await isOwner(client)) ? data.user : null;
}
