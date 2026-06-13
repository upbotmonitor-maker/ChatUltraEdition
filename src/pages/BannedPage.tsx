import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";

interface Props {
  reason?: string;
  bannedAt?: number;
}

export default function BannedPage({ reason, bannedAt }: Props) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm text-center">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-destructive/15 mb-6">
          <span className="text-4xl">🚫</span>
        </div>
        <h1 className="text-2xl font-bold text-foreground mb-2">Hesabın Banlandı</h1>
        <p className="text-muted-foreground text-sm mb-6 leading-relaxed">
          Hesabın ChatFire Ultra Edition platformundan <span className="text-destructive font-semibold">askıya alınmıştır</span> ve bu platforma erişimin kısıtlanmıştır.
        </p>

        {reason && (
          <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-4 mb-4 text-left">
            <p className="text-xs font-semibold text-destructive uppercase tracking-wide mb-1">Ban Sebebi</p>
            <p className="text-sm text-foreground">{reason}</p>
          </div>
        )}

        {bannedAt && (
          <div className="bg-muted rounded-xl p-3 mb-6 text-left">
            <p className="text-xs text-muted-foreground">
              Banlanma tarihi:{" "}
              <span className="text-foreground font-medium">
                {new Date(bannedAt).toLocaleString("tr-TR")}
              </span>
            </p>
          </div>
        )}

        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Bu kararın hatalı olduğunu düşünüyorsan platform yöneticisiyle iletişime geç.
          </p>
          <button
            data-testid="button-logout-banned"
            onClick={() => signOut(auth)}
            className="mt-4 px-6 py-2.5 rounded-xl bg-muted text-muted-foreground text-sm font-semibold hover:bg-accent transition"
          >
            Çıkış Yap
          </button>
        </div>
      </div>
    </div>
  );
}
