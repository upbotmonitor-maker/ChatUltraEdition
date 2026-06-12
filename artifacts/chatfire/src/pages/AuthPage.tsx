import { useState, useEffect } from "react";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, sendEmailVerification } from "firebase/auth";
import { doc, setDoc, getDocs, collection, query, where } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

type Tab = "login" | "register";

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5"/>
      <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
      <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  );
}

export default function AuthPage() {
  const [tab, setTab] = useState<Tab>("login");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem("chatfire-theme");
    if (saved) return saved === "dark";
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  useEffect(() => {
    if (dark) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("chatfire-theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("chatfire-theme", "light");
    }
  }, [dark]);

  const reset = () => {
    setEmail(""); setUsername(""); setPassword(""); setError("");
  };

  const switchTab = (t: Tab) => { setTab(t); reset(); };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err: unknown) {
      const msg = (err as { code?: string })?.code;
      if (msg === "auth/invalid-credential" || msg === "auth/user-not-found" || msg === "auth/wrong-password") {
        setError("E-posta veya şifre hatalı.");
      } else if (msg === "auth/too-many-requests") {
        setError("Çok fazla deneme. Lütfen bekleyin.");
      } else {
        setError("Giriş başarısız. Tekrar deneyin.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (username.length < 3) return setError("Kullanıcı adı en az 3 karakter olmalı.");
    if (!/^[a-zA-Z0-9_]+$/.test(username)) return setError("Kullanıcı adı sadece harf, rakam ve _ içerebilir.");
    if (password.length < 6) return setError("Şifre en az 6 karakter olmalı.");

    setLoading(true);
    try {
      // Check username uniqueness first
      const q = query(collection(db, "users"), where("username", "==", username.toLowerCase()));
      const snap = await getDocs(q);
      if (!snap.empty) { setLoading(false); return setError("Bu kullanıcı adı zaten kullanılıyor."); }

      // Create Firebase Auth account
      const cred = await createUserWithEmailAndPassword(auth, email, password);

      // Send verification email (Firebase built-in)
      await sendEmailVerification(cred.user);

      // Store pending registration data — Firestore doc will be created after verification
      localStorage.setItem("cf_pending_reg", JSON.stringify({
        uid: cred.user.uid,
        username: username.toLowerCase(),
        displayUsername: username,
        email,
      }));

      // NOTE: Firestore user doc is intentionally NOT created here.
      // App.tsx will create it once emailVerified = true.
      // This prevents unverified users from appearing in the user list.
    } catch (err: unknown) {
      const msg = (err as { code?: string })?.code;
      if (msg === "auth/email-already-in-use") {
        setError("Bu e-posta zaten kayıtlı.");
      } else if (msg === "auth/invalid-email") {
        setError("Geçersiz e-posta adresi.");
      } else {
        setError("Kayıt başarısız. Tekrar deneyin.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 relative">
      {/* Theme toggle top-right */}
      <button
        data-testid="button-theme-toggle"
        onClick={() => setDark(d => !d)}
        className="absolute top-4 right-4 p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        title={dark ? "Açık tema" : "Koyu tema"}
      >
        {dark ? <SunIcon /> : <MoonIcon />}
      </button>

      <div className="w-full max-w-[400px]">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary mb-4 shadow-lg">
            <span className="text-3xl">🔥</span>
          </div>
          <h1 className="text-2xl font-bold text-foreground">ChatFire</h1>
          <p className="text-sm text-muted-foreground mt-1">Ultra Edition</p>
        </div>

        {/* Card */}
        <div className="bg-card border border-card-border rounded-2xl shadow-md overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-border">
            <button
              data-testid="tab-login"
              onClick={() => switchTab("login")}
              className={`flex-1 py-3.5 text-sm font-semibold transition-colors ${
                tab === "login"
                  ? "text-primary border-b-2 border-primary bg-accent/30"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Giriş Yap
            </button>
            <button
              data-testid="tab-register"
              onClick={() => switchTab("register")}
              className={`flex-1 py-3.5 text-sm font-semibold transition-colors ${
                tab === "register"
                  ? "text-primary border-b-2 border-primary bg-accent/30"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Kayıt Ol
            </button>
          </div>

          {/* Form */}
          <div className="p-6">
            <form onSubmit={tab === "login" ? handleLogin : handleRegister} className="space-y-4">
              {tab === "register" && (
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                    Kullanıcı Adı
                  </label>
                  <input
                    data-testid="input-username"
                    type="text"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    placeholder="ör: hızlı_ali"
                    required
                    className="w-full px-3.5 py-2.5 rounded-lg border border-input bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
                  />
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                  E-posta
                </label>
                <input
                  data-testid="input-email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="sen@example.com"
                  required
                  className="w-full px-3.5 py-2.5 rounded-lg border border-input bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                  Şifre
                </label>
                <input
                  data-testid="input-password"
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder={tab === "register" ? "En az 6 karakter" : "••••••••"}
                  required
                  className="w-full px-3.5 py-2.5 rounded-lg border border-input bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
                />
              </div>

              {error && (
                <p data-testid="error-message" className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}

              <button
                data-testid="button-submit"
                type="submit"
                disabled={loading}
                className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 active:opacity-80 disabled:opacity-50 transition"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    {tab === "login" ? "Giriş yapılıyor..." : "Kayıt olunuyor..."}
                  </span>
                ) : (
                  tab === "login" ? "Giriş Yap" : "Kayıt Ol"
                )}
              </button>
            </form>
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6">
          ChatFire Ultra Edition &copy; 2025
        </p>
      </div>
    </div>
  );
}
