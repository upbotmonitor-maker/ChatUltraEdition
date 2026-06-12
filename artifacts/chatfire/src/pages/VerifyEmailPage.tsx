import { useState, useEffect, useRef } from "react";
import { signOut } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { doc, setDoc } from "firebase/firestore";

const API = "/api";

export default function VerifyEmailPage() {
  const user = auth.currentUser!;

  const [step, setStep] = useState<"sending" | "verify" | "error">("sending");
  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const [cooldown, setCooldown] = useState(0);
  const [verifying, setVerifying] = useState(false);
  const [sendError, setSendError] = useState("");
  const [verifyError, setVerifyError] = useState("");
  const [dots, setDots] = useState(".");
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Animated dots
  useEffect(() => {
    const t = setInterval(() => setDots(d => d.length >= 3 ? "." : d + "."), 500);
    return () => clearInterval(t);
  }, []);

  // Cooldown countdown
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  // Auto-send on mount
  useEffect(() => { sendCode(); }, []);

  const sendCode = async () => {
    setSendError("");
    setStep("sending");
    try {
      const res = await fetch(`${API}/email/send-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid: user.uid, email: user.email }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setSendError(json.error || "E-posta gönderilemedi.");
        setStep("error");
      } else {
        setStep("verify");
        setCooldown(60);
        // Focus first input
        setTimeout(() => inputRefs.current[0]?.focus(), 100);
      }
    } catch {
      setSendError("Sunucuya bağlanılamadı.");
      setStep("error");
    }
  };

  const handleDigit = (i: number, val: string) => {
    const digit = val.replace(/\D/g, "").slice(-1);
    const next = [...code];
    next[i] = digit;
    setCode(next);
    setVerifyError("");
    if (digit && i < 5) inputRefs.current[i + 1]?.focus();
    // Auto-verify when all 6 filled
    if (digit && next.every(d => d !== "")) verifyCode(next.join(""));
  };

  const handleKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      if (code[i]) {
        const next = [...code]; next[i] = ""; setCode(next);
      } else if (i > 0) {
        inputRefs.current[i - 1]?.focus();
      }
    } else if (e.key === "ArrowLeft" && i > 0) {
      inputRefs.current[i - 1]?.focus();
    } else if (e.key === "ArrowRight" && i < 5) {
      inputRefs.current[i + 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (pasted.length === 6) {
      const next = pasted.split("");
      setCode(next);
      setVerifyError("");
      inputRefs.current[5]?.focus();
      verifyCode(pasted);
    }
  };

  const verifyCode = async (codeStr: string) => {
    setVerifying(true);
    setVerifyError("");
    try {
      const res = await fetch(`${API}/email/verify-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid: user.uid, code: codeStr }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setVerifyError(json.error || "Kod hatalı.");
        setCode(["", "", "", "", "", ""]);
        setTimeout(() => inputRefs.current[0]?.focus(), 50);
        return;
      }

      // Kod doğru → Firestore doc oluştur (artık kullanıcı listesinde görünür)
      const raw = localStorage.getItem("cf_pending_reg");
      let regData: { uid: string; username: string; displayUsername: string; email: string } | null = null;
      if (raw) {
        try { regData = JSON.parse(raw); } catch {}
      }
      if (regData && regData.uid === user.uid) {
        await setDoc(doc(db, "users", user.uid), {
          uid: user.uid,
          username: regData.username,
          displayUsername: regData.displayUsername,
          email: regData.email,
          photoURL: "",
          createdAt: Date.now(),
          emailVerified: true,
        });
        localStorage.removeItem("cf_pending_reg");
      }
      // App.tsx will detect Firestore doc creation and navigate to chat
    } catch {
      setVerifyError("Sunucuya bağlanılamadı.");
      setCode(["", "", "", "", "", ""]);
    } finally {
      setVerifying(false);
    }
  };

  const handleVerifyBtn = () => {
    const full = code.join("");
    if (full.length === 6) verifyCode(full);
  };

  // Masked email
  const maskedEmail = (() => {
    const email = user?.email || "";
    const [local, domain] = email.split("@");
    if (!domain) return email;
    return `${local.slice(0, 2)}***@${domain}`;
  })();

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-[420px]">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary mb-4 shadow-lg">
            <span className="text-3xl">🔥</span>
          </div>
          <h1 className="text-2xl font-bold text-foreground">ChatFire</h1>
          <p className="text-sm text-muted-foreground mt-1">Ultra Edition</p>
        </div>

        <div className="bg-card border border-card-border rounded-2xl shadow-md overflow-hidden">
          {/* Top gradient accent */}
          <div className="h-1 bg-gradient-to-r from-primary via-orange-400 to-yellow-400" />

          <div className="p-6 space-y-5">

            {/* Icon + title */}
            <div className="text-center space-y-2">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-blue-500/10 border-2 border-blue-500/20">
                {step === "sending"
                  ? <span className="w-6 h-6 border-2 border-blue-200 border-t-blue-500 rounded-full animate-spin" />
                  : <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                      <polyline points="22,6 12,13 2,6"/>
                    </svg>
                }
              </div>
              <h2 className="text-lg font-bold text-foreground">
                {step === "sending" ? `E-posta gönderiliyor${dots}` : "E-postanı doğrula"}
              </h2>
              {step !== "sending" && (
                <p className="text-sm text-muted-foreground leading-relaxed">
                  <span className="font-semibold text-foreground">{maskedEmail}</span> adresine
                  6 haneli doğrulama kodu gönderdik.
                </p>
              )}
            </div>

            {/* Error state */}
            {step === "error" && (
              <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-4 text-center space-y-3">
                <p className="text-sm text-destructive">{sendError}</p>
                <button onClick={sendCode}
                  className="px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:opacity-90 transition">
                  Tekrar Dene
                </button>
              </div>
            )}

            {/* 6-digit code input */}
            {step === "verify" && (
              <div className="space-y-4">
                {/* OTP boxes */}
                <div className="flex gap-2 justify-center" onPaste={handlePaste}>
                  {code.map((d, i) => (
                    <input
                      key={i}
                      ref={el => { inputRefs.current[i] = el; }}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={d}
                      onChange={e => handleDigit(i, e.target.value)}
                      onKeyDown={e => handleKeyDown(i, e)}
                      disabled={verifying}
                      className={`w-11 h-14 text-center text-2xl font-bold rounded-xl border-2 bg-background text-foreground transition focus:outline-none
                        ${d ? "border-primary" : "border-input"}
                        ${verifying ? "opacity-50" : "focus:border-primary focus:ring-2 focus:ring-primary/20"}
                        ${verifyError ? "border-destructive animate-[wiggle_0.3s_ease]" : ""}
                      `}
                    />
                  ))}
                </div>

                {/* Verify error */}
                {verifyError && (
                  <p className="text-sm text-destructive text-center bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
                    {verifyError}
                  </p>
                )}

                {/* Verify button (also works when all filled) */}
                <button
                  onClick={handleVerifyBtn}
                  disabled={code.join("").length !== 6 || verifying}
                  className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  {verifying
                    ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Doğrulanıyor...</>
                    : "Kodu Doğrula"
                  }
                </button>

                {/* Resend */}
                <button
                  onClick={sendCode}
                  disabled={cooldown > 0}
                  className="w-full py-2.5 rounded-xl border border-input bg-background text-sm font-medium text-foreground hover:bg-muted transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {cooldown > 0
                    ? <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>Tekrar gönder ({cooldown}s)</>
                    : <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.96"/></svg>Kodu tekrar gönder</>
                  }
                </button>

                {/* Spam notice */}
                <p className="text-xs text-muted-foreground text-center">
                  Gelmedi mi? <span className="font-medium">Spam / Junk</span> klasörünü kontrol et.
                </p>
              </div>
            )}

            <div className="border-t border-border pt-3">
              <button onClick={() => signOut(auth)}
                className="w-full py-2 rounded-xl text-sm font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition flex items-center justify-center gap-2">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
                </svg>
                Farklı bir hesapla giriş yap
              </button>
            </div>
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6">ChatFire Ultra Edition &copy; 2025</p>
      </div>
    </div>
  );
}
