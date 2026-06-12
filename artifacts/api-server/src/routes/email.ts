import { Router } from "express";

const router = Router();

const FROM_EMAIL = "chatfire.team@gmail.com";
const FROM_NAME = "ChatFire";

// In-memory code store: uid -> { code, expiresAt }
const codeStore = new Map<string, { code: string; expiresAt: number }>();

function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// POST /api/email/send-code
router.post("/email/send-code", async (req, res) => {
  try {
    const BREVO_API_KEY = process.env["BREVO_API_KEY"];

    if (!BREVO_API_KEY) {
      req.log.error("BREVO_API_KEY is not set");
      res.status(500).json({ ok: false, error: "Email service not configured" });
      return;
    }

    const { uid, email } = req.body as { uid?: string; email?: string };

    if (!uid || !email) {
      res.status(400).json({ ok: false, error: "uid and email are required" });
      return;
    }

    const code = generateCode();
    codeStore.set(uid, { code, expiresAt: Date.now() + 10 * 60 * 1000 });

    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "accept": "application/json",
        "api-key": BREVO_API_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sender: { name: FROM_NAME, email: FROM_EMAIL },
        to: [{ email }],
        subject: "ChatFire - E-posta Doğrulama Kodunuz",
        htmlContent: `
          <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#1a1a2e;color:#fff;border-radius:12px;">
            <div style="text-align:center;margin-bottom:24px;">
              <div style="font-size:48px;">🔥</div>
              <h1 style="color:#ff6b35;font-size:24px;margin:8px 0;">ChatFire Ultra Edition</h1>
            </div>
            <h2 style="font-size:18px;font-weight:600;margin-bottom:8px;">E-posta Doğrulama</h2>
            <p style="color:#aaa;margin-bottom:24px;">Doğrulama kodunuz:</p>
            <div style="background:#2a2a4a;border:1px solid #ff6b35;border-radius:8px;padding:20px;text-align:center;margin-bottom:24px;">
              <span style="font-size:36px;font-weight:bold;letter-spacing:12px;color:#ff6b35;">${code}</span>
            </div>
            <p style="color:#aaa;font-size:13px;">Bu kod 10 dakika geçerlidir.</p>
            <hr style="border:none;border-top:1px solid #333;margin:24px 0;" />
            <p style="color:#555;font-size:12px;text-align:center;">ChatFire Ultra Edition &copy; 2025</p>
          </div>
        `,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      req.log.error({ status: response.status, errText }, "Brevo API error");
      res.status(500).json({ ok: false, error: "E-posta gönderilemedi." });
      return;
    }

    req.log.info({ email }, "Verification code sent");
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to send verification email");
    res.status(500).json({ ok: false, error: "Sunucuya bağlanılamadı." });
  }
});

// POST /api/email/verify-code
router.post("/email/verify-code", (req, res) => {
  try {
    const { uid, code } = req.body as { uid?: string; code?: string };

    if (!uid || !code) {
      res.status(400).json({ ok: false, error: "uid and code are required" });
      return;
    }

    const entry = codeStore.get(uid);

    if (!entry) {
      res.status(400).json({ ok: false, error: "Kod bulunamadı. Lütfen yeni kod isteyin." });
      return;
    }

    if (Date.now() > entry.expiresAt) {
      codeStore.delete(uid);
      res.status(400).json({ ok: false, error: "Kodun süresi doldu. Lütfen yeni kod isteyin." });
      return;
    }

    if (entry.code !== code) {
      res.status(400).json({ ok: false, error: "Kod hatalı." });
      return;
    }

    codeStore.delete(uid);
    req.log.info({ uid }, "Email verified successfully");
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to verify code");
    res.status(500).json({ ok: false, error: "Sunucuya bağlanılamadı." });
  }
});

export default router;
