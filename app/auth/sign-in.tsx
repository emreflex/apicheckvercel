"use client";

import { useActionState } from "react";
import { ArrowRight } from "lucide-react";
import { signIn, type SignInState } from "./actions";

const initialState: SignInState = { error: "" };

export function SignInForm() {
  const [state, action, pending] = useActionState(signIn, initialState);

  return (
    <form className="login-form" action={action}>
      <label>
        E-posta
        <input name="email" type="email" placeholder="ornek@eposta.com" autoComplete="username" required maxLength={254} />
      </label>
      <label>
        Parola
        <input name="password" type="password" autoComplete="current-password" required maxLength={1024} />
      </label>
      {state.error && <p className="form-error" role="alert">{state.error}</p>}
      <button className="action-primary" type="submit" disabled={pending}>
        {pending ? "Doğrulanıyor…" : "Giriş yap"} <ArrowRight size={17} aria-hidden="true" />
      </button>
    </form>
  );
}
