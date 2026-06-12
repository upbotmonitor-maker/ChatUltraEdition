import { Router, type IRouter, type Request, type Response } from "express";

const router: IRouter = Router();

const codeStore = new Map<string, { code: string; email: string; expiresAt: number; attempts: number }>();

function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// POST /api/email/send-code  { uid, email }
router.post("/email/send-code", async (req: Request, res: Response) => {
  const { uid, email } = req.body as { uid?: string; email?: string };
  if (!uid || !email) {
    res.status(400).json({ ok: false, error: "uid ve email zorunlu" });
    return;
  }

  const existing = codeStore.get(uid);
  if (existing && existing.expiresAt - 4 * 60 * 1000 > Date.now() - 60 * 1000) {
    res.status(429).json({ ok: false, error: "Lütfen 60 saniye bekleyin." });
    return;
  }

  const code = generateCode();
  const expiresAt = Date.now() + 5 * 60 * 1000;
  codeStore.set(uid, { code, email, expiresAt, attempts: 0 });

  const BREVO_API_KEY = process.env["BREVO_API_KEY"];
  if (!BREVO_API_KEY) {
    req.log.error("BREVO_API_KEY eksik");
    res.status(500).json({ ok: false, error: "Sunucu yapılandırma hatası." });
    return;
  }

  const htmlContent = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; background: #fff; border-radius: 16px; overflow: hidden; border: 1px solid #e5e7eb;">
      <div style="background: linear-gradient(135deg, #f97316, #ef4444); padding: 32px 24px; text-align: center;">
        <div style="font-size: 40px;">🔥</div>
        <h1 style="color: #fff; margin: 8px 0 4px; font-size: 22px; font-weight: 700;">ChatFire</h1>
        <p style="color: rgba(255,255,255,0.85); margin: 0; font-size: 13px;">Ultra Edition</p>
      </div>
      <div style="padding: 32px 24px; text-align: center;">
        <h2 style="color: #111827; font-size: 18px; margin: 0 0 8px;">E-posta Doğrulama Kodu</h2>
        <p style="color: #6b7280; font-size: 14px; margin: 0 0 24px;">ChatFire hesabını doğrulamak için aşağıdaki kodu gir:</p>
        <div style="background: #f9fafb; border: 2px dashed #f97316; border-radius: 12px; padding: 20px 32px; display: inline-block; margin-bottom: 24px;">
          <span style="font-size: 40px; font-weight: 800; letter-spacing: 10px; color: #f97316; font-family: monospace;">${code}</span>
        </div>
        <p style="color: #9ca3af; font-size: 13px; margin: 0 0 4px;">Bu kod <strong>5 dakika</strong> geçerlidir.</p>
        <p style="color: #9ca3af; font-size: 13px; margin: 0;">Bu e-postayı istemediysen görmezden gel.</p>
      </div>
      <div style="background: #f9fafb; padding: 16px 24px; text-align: center; border-top: 1px solid #e5e7eb;">
        <p style="color: #9ca3af; font-size: 12px; margin: 0;">ChatFire Ultra Edition &copy; 2025</p>
      </div>
    </div>
  `;

  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "accept": "application/json",
        "api-key": BREVO_API_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sender: { name: "ChatFire 🔥", email: "noreply@chatfire.app" },
        to: [{ email }],
        subject: "ChatFire — E-posta Doğrulama Kodun",
        htmlContent,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      req.log.error({ status: response.status, body: errBody }, "Brevo send failed");
      res.status(500).json({ ok: false, error: "E-posta gönderilemedi." });
      return;
    }

    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Brevo fetch failed");
    res.status(500).json({ ok: false, error: "E-posta gönderilemedi." });
  }
});

// POST /api/email/verify-code  { uid, code }
router.post("/email/verify-code", (req: Request, res: Response) => {
  const { uid, code } = req.body as { uid?: string; code?: string };
  if (!uid || !code) {
    res.status(400).json({ ok: false, error: "uid ve code zorunlu" });
    return;
  }

  const entry = codeStore.get(uid);
  if (!entry) {
    res.status(400).json({ ok: false, error: "Kod bulunamadı. Yeniden gönder." });
    return;
  }
  if (Date.now() > entry.expiresAt) {
    codeStore.delete(uid);
    res.status(400).json({ ok: false, error: "Kodun süresi doldu. Yeniden gönder." });
    return;
  }
  entry.attempts += 1;
  if (entry.attempts > 5) {
    codeStore.delete(uid);
    res.status(400).json({ ok: false, error: "Çok fazla hatalı deneme. Yeniden gönder." });
    return;
  }
  if (entry.code !== code.trim()) {
    res.status(400).json({ ok: false, error: `Yanlış kod. ${5 - entry.attempts} deneme hakkın kaldı.` });
    return;
  }

  codeStore.delete(uid);
  res.json({ ok: true });
});

export default router;
