import { Router } from "express";

const router = Router();

const FROM_EMAIL = "chatfire.team@gmail.com";
const FROM_NAME = "ChatFire";

router.post("/send-verification", async (req, res) => {
  try {
    const BREVO_API_KEY = process.env["BREVO_API_KEY"];

    if (!BREVO_API_KEY) {
      req.log.error("BREVO_API_KEY is not set");
      res.status(500).json({ error: "Email service not configured" });
      return;
    }

    const { email, code } = req.body as { email?: string; code?: string };

    if (!email || !code) {
      res.status(400).json({ error: "email and code are required" });
      return;
    }

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
      const err = await response.text();
      req.log.error({ status: response.status, err }, "Brevo API error");
      res.status(500).json({ error: "Failed to send email" });
      return;
    }

    req.log.info({ email }, "Verification email sent via Brevo");
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to send verification email");
    res.status(500).json({ error: "Failed to send email" });
  }
});

export default router;
