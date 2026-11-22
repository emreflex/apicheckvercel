import { ChartNoAxesColumnIncreasing, CircleAlert, LockKeyhole } from "lucide-react";
import Dashboard from "./dashboard";
import { SignInForm } from "./auth/sign-in";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { createClient, getOwner } from "@/lib/supabase/server";
import { getSnapshots } from "@/lib/supabase/archives";

export const dynamic = "force-dynamic";

function Login({ configured, error }: { configured: boolean; error?: string }) {
  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-brand">
          <span><ChartNoAxesColumnIncreasing size={21} aria-hidden="true" /></span>
          Takip Defteri
        </div>
        <h1 id="login-title">{error ? "Panele erişilemiyor" : "Takip Defteri’ne giriş yap"}</h1>
        {error ? (
          <>
            <p className="form-error" role="alert">{error}</p>
            <a className="action-primary" href="/">Yeniden dene</a>
          </>
        ) : configured ? (
          <>
            <p>Takip isteklerinin durumunu ve geçmişini görüntüle.</p>
            <SignInForm />
          </>
        ) : (
          <div className="login-notice">
            <CircleAlert size={20} aria-hidden="true" />
            <p>Giriş yapabilmek için önce README’deki Supabase kurulumunu tamamla.</p>
          </div>
        )}
        <p className="login-privacy"><LockKeyhole size={15} aria-hidden="true" /> Arşiv kayıtlarına yalnızca izin verilen hesap erişebilir.</p>
      </section>
    </main>
  );
}

export default async function HomePage() {
  if (!getSupabaseConfig()) return <Login configured={false} />;

  try {
    const supabase = await createClient();
    const user = await getOwner(supabase);
    if (!user) return <Login configured />;
    const snapshots = await getSnapshots(supabase);
    return <Dashboard initialSnapshots={snapshots} email={user.email ?? ""} />;
  } catch {
    return <Login configured error="Supabase oturumu veya arşiv kayıtları şu anda okunamadı." />;
  }
}
