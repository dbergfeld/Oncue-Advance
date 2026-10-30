import { useState } from "react";
import { useUsers } from "../context/UserContext";

export function SignIn() {
  const { signIn, signUp } = useUsers();
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setSubmitting(true);
    const result = mode === "signIn" ? await signIn(email, password) : await signUp(email, password);
    setSubmitting(false);
    if (result) {
      setError(result);
    } else if (mode === "signUp") {
      setInfo("Account created. Check your email to confirm, then sign in.");
      setMode("signIn");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4">
      <div className="oc-card w-full max-w-sm p-6">
        <h1 className="text-lg font-semibold text-neutral-50">OnCue: Advance</h1>
        <p className="mt-1 text-sm text-neutral-500">{mode === "signIn" ? "Sign in to continue." : "Create an account."}</p>

        <form onSubmit={handleSubmit} className="mt-5 space-y-3">
          <div>
            <label className="oc-label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              className="oc-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="oc-label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={6}
              autoComplete={mode === "signIn" ? "current-password" : "new-password"}
              className="oc-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}
          {info && <p className="text-xs text-accent">{info}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-surface hover:bg-accent-dim disabled:opacity-50"
          >
            {submitting ? "Please wait…" : mode === "signIn" ? "Sign in" : "Sign up"}
          </button>
        </form>

        <button
          type="button"
          className="mt-4 text-xs text-neutral-500 hover:text-neutral-300"
          onClick={() => {
            setError(null);
            setInfo(null);
            setMode(mode === "signIn" ? "signUp" : "signIn");
          }}
        >
          {mode === "signIn" ? "Need an account? Sign up" : "Already have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}
