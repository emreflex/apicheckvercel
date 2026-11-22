"use server";

import { redirect } from "next/navigation";
import { createClient, isOwner } from "@/lib/supabase/server";
import { getSupabaseConfig } from "@/lib/supabase/config";

export interface SignInState {
  error: string;
}

export async function signIn(_state: SignInState, form: FormData): Promise<SignInState> {
  const email = form.get("email");
  const password = form.get("password");
  const denied = { error: "E-posta veya parola geçersiz ya da bu hesabın erişim izni yok." };
  if (typeof email !== "string" || !email.trim() || email.length > 254 ||
      typeof password !== "string" || !password || password.length > 1024) {
    return denied;
  }

  if (!getSupabaseConfig()) return { error: "Supabase bağlantısı yapılandırılmamış." };
  const supabase = await createClient();

  try {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) return denied;
    if (!(await isOwner(supabase))) {
      await supabase.auth.signOut({ scope: "local" });
      return denied;
    }
  } catch {
    await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    return { error: "Oturum şu anda doğrulanamadı. Lütfen tekrar dene." };
  }
  redirect("/");
}

export async function signOut() {
  if (getSupabaseConfig()) {
    const supabase = await createClient();
    await supabase.auth.signOut({ scope: "local" });
  }
  redirect("/");
}
