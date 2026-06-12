import { useState, useEffect } from "react";
import {
  collection, getDocs, doc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, addDoc, serverTimestamp, Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

const ADMIN_PASSWORD = "9999";

interface UserData {
  uid: string;
  username: string;
  displayUsername: string;
  email: string;
  photoURL: string;
  createdAt: number;
  banned?: boolean;
  banReason?: string;
  bannedAt?: number;
  verified?: boolean;
  aiLabel?: string;
  aiLabelAt?: number;
}

interface ConvData {
  id: string;
  participants: string[];
  lastMessage?: string;
  lastMessageAt?: Timestamp;
  createdAt?: Timestamp;
  msgCount?: number;
}

interface MsgData {
  id: string;
  senderId: string;
  text?: string;
  type?: string;
  createdAt: Timestamp | null;
}

type Tab = "dashboard" | "users" | "logs" | "banned";

// VerifiedBadge — blue shield checkmark
function VerifiedBadge({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="inline-block flex-shrink-0" title="Resmi Doğrulanmış Hesap">
      <path d="M12 1L3 5v6c0 5.25 3.75 10.16 9 11.25C17.25 21.16 21 16.25 21 11V5L12 1z" fill="#3b82f6" />
      <path d="M9 12l2 2 4-4" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </svg>
  );
}

function Avatar({ user, size = 32 }: { user: UserData | null; size?: number }) {
  if (user?.photoURL) {
    return <img src={user.photoURL} alt="" style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />;
  }
  const letter = (user?.displayUsername || user?.username || "?")[0].toUpperCase();
  const colors = ["#f97316", "#ef4444", "#ec4899", "#8b5cf6", "#3b82f6", "#10b981"];
  const color = colors[(user?.uid?.charCodeAt(0) ?? 0) % colors.length];
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: color, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: size * 0.42, flexShrink: 0 }}>
      {letter}
    </div>
  );
}

function formatDate(ts: Timestamp | number | undefined | null) {
  if (!ts) return "—";
  const d = ts instanceof Timestamp ? ts.toDate() : new Date(ts);
  return d.toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function AiLabelBadge({ label }: { label: string }) {
  const style =
    label.includes("TOKSİK") ? "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30" :
    label.includes("UYARI") ? "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30" :
    label.includes("SPAM") ? "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/30" :
    label.includes("TROLL") ? "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30" :
    label.includes("GÜVENLİ") ? "bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/30" :
    label.includes("AKTİF") ? "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30" :
    "bg-muted text-muted-foreground border-border";
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${style} whitespace-nowrap`}>
      {label}
    </span>
  );
}

// Heuristic AI behavior analysis — no API key needed
async function analyzeUser(user: UserData, convs: ConvData[]): Promise<string> {
  const myConvs = convs.filter(c => c.participants.includes(user.uid));
  if (myConvs.length === 0) return "👋 YENİ KULLANICI";

  const allMessages: string[] = [];
  const timestamps: number[] = [];

  for (const conv of myConvs) {
    const q = query(collection(db, "conversations", conv.id, "messages"), orderBy("createdAt", "asc"));
    const snap = await getDocs(q);
    snap.forEach(d => {
      const msg = d.data();
      if (msg.senderId === user.uid && msg.text && msg.type !== "system") {
        allMessages.push(String(msg.text));
        if (msg.createdAt?.toMillis) timestamps.push(msg.createdAt.toMillis());
      }
    });
  }

  if (allMessages.length === 0) return "👋 YENİ KULLANICI";

  const total = allMessages.length;
  const allText = allMessages.join(" ").toLowerCase();

  // Toxic keywords (Turkish)
  const toxic = ["sik","orospu","piç","amk","salak","aptal","gerizekalı","mal ","öldür","yavşak","göt","amına","kahpe","kaltak","bok ","serefsiz"];
  const harshWords = ["lanet","berbat","rezil","ahmak","züppe","dangalak","sürtük","hain"];
  const toxicHits = toxic.filter(k => allText.includes(k)).length;
  const harshHits = harshWords.filter(k => allText.includes(k)).length;

  // Spam: repetitive short messages
  const avgLen = allMessages.reduce((s, m) => s + m.length, 0) / total;
  const msgCounts = new Map<string, number>();
  allMessages.forEach(m => msgCounts.set(m, (msgCounts.get(m) || 0) + 1));
  const maxRepeat = Math.max(...Array.from(msgCounts.values()));
  const spamScore = (maxRepeat > 5 ? 2 : maxRepeat > 3 ? 1 : 0) + (avgLen < 6 ? 1 : 0);

  // Burst detection: many messages in a short time
  let burstScore = 0;
  if (timestamps.length >= 10) {
    timestamps.sort((a, b) => a - b);
    for (let i = 9; i < timestamps.length; i++) {
      if (timestamps[i] - timestamps[i - 9] < 60000) { burstScore = 2; break; }
    }
  }

  // Score → label
  if (toxicHits >= 3) return "🔴 TOKSİK KULLANICI";
  if (toxicHits >= 1 && (spamScore >= 1 || burstScore >= 1)) return "⚠️ POTANSİYEL TROLL";
  if (toxicHits >= 1 || harshHits >= 2) return "🟠 UYARI: KABA DİL";
  if (spamScore >= 2 || burstScore >= 2) return "📨 SPAM RİSKİ";
  if (spamScore >= 1) return "🟡 ŞÜPHELİ AKTİVİTE";
  if (total >= 50) return "💬 AKTİF KULLANICI";
  if (total >= 10) return "✅ GÜVENLİ KULLANICI";
  return "👋 YENİ KULLANICI";
}

export default function AdminPage() {
  const [authed, setAuthed] = useState(() => sessionStorage.getItem("cf_admin") === "ok");
  const [pw, setPw] = useState("");
  const [pwError, setPwError] = useState(false);
  const [tab, setTab] = useState<Tab>("dashboard");
  const [users, setUsers] = useState<UserData[]>([]);
  const [convs, setConvs] = useState<ConvData[]>([]);
  const [totalMessages, setTotalMessages] = useState(0);
  const [selectedConv, setSelectedConv] = useState<ConvData | null>(null);
  const [convMessages, setConvMessages] = useState<MsgData[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [banModal, setBanModal] = useState<UserData | null>(null);
  const [banReason, setBanReason] = useState("");
  const [searchUser, setSearchUser] = useState("");
  const [notification, setNotification] = useState("");
  const [analyzingAll, setAnalyzingAll] = useState(false);
  const [analyzingUid, setAnalyzingUid] = useState<string | null>(null);
  const [sysMsg, setSysMsg] = useState("");
  const [sendingSys, setSendingSys] = useState(false);

  const notify = (msg: string) => { setNotification(msg); setTimeout(() => setNotification(""), 3000); };

  useEffect(() => {
    if (!authed) return;
    return onSnapshot(collection(db, "users"), snap => {
      const list: UserData[] = [];
      snap.forEach(d => list.push(d.data() as UserData));
      list.sort((a, b) => b.createdAt - a.createdAt);
      setUsers(list);
    });
  }, [authed]);

  useEffect(() => {
    if (!authed) return;
    getDocs(collection(db, "conversations")).then(async snap => {
      const list: ConvData[] = [];
      let totalMsg = 0;
      for (const d of snap.docs) {
        const data = d.data() as Omit<ConvData, "id" | "msgCount">;
        const msgsSnap = await getDocs(collection(db, "conversations", d.id, "messages"));
        totalMsg += msgsSnap.size;
        list.push({ id: d.id, ...data, msgCount: msgsSnap.size });
      }
      list.sort((a, b) => (b.lastMessageAt?.toMillis() ?? 0) - (a.lastMessageAt?.toMillis() ?? 0));
      setConvs(list);
      setTotalMessages(totalMsg);
    });
  }, [authed]);

  const loadConvMessages = async (conv: ConvData) => {
    setSelectedConv(conv);
    setLoadingLogs(true);
    const q = query(collection(db, "conversations", conv.id, "messages"), orderBy("createdAt", "asc"));
    const snap = await getDocs(q);
    const msgs: MsgData[] = [];
    snap.forEach(d => msgs.push({ id: d.id, ...(d.data() as Omit<MsgData, "id">) }));
    setConvMessages(msgs);
    setLoadingLogs(false);
  };

  const banUser = async (user: UserData, reason: string) => {
    await updateDoc(doc(db, "users", user.uid), { banned: true, banReason: reason || "Sebep belirtilmedi", bannedAt: Date.now() });
    setBanModal(null); setBanReason("");
    notify(`@${user.username} banlandı.`);
  };

  const unbanUser = async (user: UserData) => {
    await updateDoc(doc(db, "users", user.uid), { banned: false, banReason: "", bannedAt: null });
    notify(`@${user.username} banı kaldırıldı.`);
  };

  const deleteUser = async (user: UserData) => {
    if (!confirm(`@${user.username} kullanıcısını SİLmek istediğinden emin misin?`)) return;
    await deleteDoc(doc(db, "users", user.uid));
    notify(`@${user.username} silindi.`);
  };

  const verifyUser = async (user: UserData) => {
    await updateDoc(doc(db, "users", user.uid), { verified: true });
    notify(`@${user.username} doğrulandı ✓`);
  };

  const unverifyUser = async (user: UserData) => {
    await updateDoc(doc(db, "users", user.uid), { verified: false });
    notify(`@${user.username} doğrulama kaldırıldı.`);
  };

  const analyzeOne = async (user: UserData) => {
    setAnalyzingUid(user.uid);
    const label = await analyzeUser(user, convs);
    await updateDoc(doc(db, "users", user.uid), { aiLabel: label, aiLabelAt: Date.now() });
    setAnalyzingUid(null);
    notify(`@${user.username} analiz edildi: ${label}`);
  };

  const analyzeAll = async () => {
    setAnalyzingAll(true);
    for (const user of users.filter(u => !u.banned)) {
      const label = await analyzeUser(user, convs);
      await updateDoc(doc(db, "users", user.uid), { aiLabel: label, aiLabelAt: Date.now() });
    }
    setAnalyzingAll(false);
    notify("Tüm kullanıcılar analiz edildi.");
  };

  const deleteConvMsg = async (convId: string, msgId: string) => {
    await deleteDoc(doc(db, "conversations", convId, "messages", msgId));
    setConvMessages(prev => prev.filter(m => m.id !== msgId));
    notify("Mesaj silindi.");
  };

  const sendSystemMessage = async () => {
    if (!selectedConv || !sysMsg.trim() || sendingSys) return;
    setSendingSys(true);
    try {
      await addDoc(collection(db, "conversations", selectedConv.id, "messages"), {
        senderId: "SYSTEM",
        type: "system",
        text: sysMsg.trim(),
        createdAt: serverTimestamp(),
      });
      await updateDoc(doc(db, "conversations", selectedConv.id), {
        lastMessage: `⚙️ SİSTEM: ${sysMsg.trim()}`,
        lastMessageAt: serverTimestamp(),
        lastSenderId: "SYSTEM",
      });
      setSysMsg("");
      notify("Sistem mesajı gönderildi.");
      await loadConvMessages(selectedConv);
    } finally { setSendingSys(false); }
  };

  const getUserById = (uid: string) => users.find(u => u.uid === uid);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (pw === ADMIN_PASSWORD) { sessionStorage.setItem("cf_admin", "ok"); setAuthed(true); }
    else { setPwError(true); setTimeout(() => setPwError(false), 1500); }
  };

  const bannedUsers = users.filter(u => u.banned);
  const activeUsers = users.filter(u => !u.banned);
  const verifiedUsers = users.filter(u => u.verified);
  const filteredUsers = (tab === "banned" ? bannedUsers : users).filter(u =>
    (u.displayUsername || u.username).toLowerCase().includes(searchUser.toLowerCase()) ||
    u.email.toLowerCase().includes(searchUser.toLowerCase())
  );

  // ---- Login ----
  if (!authed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-destructive mb-3 shadow-lg"><span className="text-2xl">🛡️</span></div>
            <h1 className="text-xl font-bold text-foreground">Admin Paneli</h1>
            <p className="text-xs text-muted-foreground mt-1">ChatFire Ultra Edition</p>
          </div>
          <div className="bg-card border border-card-border rounded-2xl shadow-md p-6">
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Admin Şifresi</label>
                <input data-testid="input-admin-password" type="password" value={pw} onChange={e => setPw(e.target.value)} placeholder="••••" autoFocus
                  className={`w-full px-3.5 py-2.5 rounded-lg border text-sm text-foreground bg-background focus:outline-none focus:ring-2 focus:ring-ring transition ${pwError ? "border-destructive ring-2 ring-destructive/40 animate-bounce" : "border-input"}`} />
                {pwError && <p className="text-xs text-destructive mt-1">Yanlış şifre.</p>}
              </div>
              <button type="submit" className="w-full py-2.5 bg-destructive text-destructive-foreground text-sm font-semibold rounded-lg hover:opacity-90 transition">Giriş Yap</button>
            </form>
          </div>
          <p className="text-center text-xs text-muted-foreground mt-4"><a href="/" className="hover:text-primary transition-colors">← Uygulamaya dön</a></p>
        </div>
      </div>
    );
  }

  // ---- Admin Panel ----
  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Toast */}
      {notification && (
        <div className="fixed top-4 right-4 z-50 bg-primary text-primary-foreground text-sm px-4 py-2.5 rounded-xl shadow-lg">✓ {notification}</div>
      )}

      {/* Top bar */}
      <div className="bg-card border-b border-border px-4 md:px-6 py-3 flex items-center gap-3">
        <span className="text-lg">🛡️</span>
        <div><h1 className="text-sm font-bold text-foreground">ChatFire Admin</h1><p className="text-xs text-muted-foreground">AI Sentinel Engine</p></div>
        <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          <span className="hidden sm:inline">{users.length} kullanıcı · {verifiedUsers.length} doğrulanmış · {totalMessages} mesaj</span>
          <a href="/" className="text-xs text-primary hover:underline">← Uygulamaya dön</a>
          <button onClick={() => { sessionStorage.removeItem("cf_admin"); setAuthed(false); }} className="ml-1 px-2.5 py-1 rounded-md bg-muted text-muted-foreground hover:bg-destructive/10 hover:text-destructive text-xs transition">Çıkış</button>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-card border-b border-border px-4 md:px-6 flex gap-1 overflow-x-auto">
        {([
          { id: "dashboard", label: "📊 Özet" },
          { id: "users", label: `👥 Kullanıcılar (${activeUsers.length})` },
          { id: "logs", label: `💬 Sohbet Logları (${convs.length})` },
          { id: "banned", label: `🚫 Banlılar (${bannedUsers.length})` },
        ] as { id: Tab; label: string }[]).map(t => (
          <button key={t.id} onClick={() => { setTab(t.id); setSelectedConv(null); }}
            className={`px-3 py-3 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors ${tab === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 p-4 md:p-6 max-w-6xl mx-auto w-full">

        {/* DASHBOARD */}
        {tab === "dashboard" && (
          <div className="space-y-6">
            <h2 className="text-lg font-bold text-foreground">Genel Özet</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: "Toplam Kullanıcı", value: users.length, icon: "👥", color: "text-blue-600 dark:text-blue-400" },
                { label: "Doğrulanmış", value: verifiedUsers.length, icon: "✓", color: "text-[#3b82f6]" },
                { label: "Toplam Sohbet", value: convs.length, icon: "💬", color: "text-orange-600 dark:text-orange-400" },
                { label: "Toplam Mesaj", value: totalMessages, icon: "📨", color: "text-purple-600 dark:text-purple-400" },
              ].map(s => (
                <div key={s.label} className="rounded-xl p-4 border border-border bg-card">
                  <div className="text-2xl mb-2">{s.icon}</div>
                  <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>

            {/* AI Analysis summary */}
            <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span>🤖</span>
                  <p className="text-sm font-semibold text-foreground">AI Sentinel — Davranış Analizi</p>
                </div>
                <button onClick={analyzeAll} disabled={analyzingAll}
                  className="px-3 py-1.5 text-xs font-semibold bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 rounded-lg transition disabled:opacity-50 flex items-center gap-1.5">
                  {analyzingAll ? <><span className="w-3 h-3 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin" />Analiz ediluyor...</> : "⚡ Tümünü Analiz Et"}
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {users.filter(u => u.aiLabel).slice(0, 12).map(u => (
                  <div key={u.uid} className="flex items-center gap-1.5 bg-card border border-border rounded-lg px-2 py-1">
                    <span className="text-xs font-medium text-foreground">@{u.username}</span>
                    <AiLabelBadge label={u.aiLabel!} />
                  </div>
                ))}
                {users.filter(u => !u.aiLabel).length > 0 && (
                  <span className="text-xs text-muted-foreground self-center">{users.filter(u => !u.aiLabel).length} kullanıcı analiz edilmedi</span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* USERS */}
        {tab === "users" && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <h2 className="text-lg font-bold text-foreground flex-1">Kullanıcılar</h2>
              <input type="text" value={searchUser} onChange={e => setSearchUser(e.target.value)} placeholder="Kullanıcı ara..."
                className="px-3 py-2 text-sm rounded-lg border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition sm:w-64" />
            </div>
            <div className="space-y-2">
              {filteredUsers.filter(u => !u.banned).map(u => (
                <div key={u.uid} className="flex items-center gap-3 bg-card border border-border rounded-xl px-4 py-3">
                  <Avatar user={u} size={36} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-sm font-semibold text-foreground">{u.displayUsername || u.username}</p>
                      {u.verified && <VerifiedBadge size={15} />}
                      <span className="text-xs text-muted-foreground">@{u.username}</span>
                      {u.aiLabel && <AiLabelBadge label={u.aiLabel} />}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5 shrink-0">
                    {/* Verify button */}
                    {u.verified
                      ? <button onClick={() => unverifyUser(u)} className="px-2.5 py-1.5 text-xs font-semibold bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 rounded-lg transition" title="Doğrulamayı kaldır">✓ Onaylı</button>
                      : <button onClick={() => verifyUser(u)} className="px-2.5 py-1.5 text-xs font-semibold bg-muted text-muted-foreground hover:bg-blue-500/10 hover:text-blue-600 rounded-lg transition" title="Resmi olarak doğrula">✓ Onayla</button>
                    }
                    {/* AI analyze */}
                    <button onClick={() => analyzeOne(u)} disabled={analyzingUid === u.uid}
                      className="px-2.5 py-1.5 text-xs font-semibold bg-purple-500/10 text-purple-600 dark:text-purple-400 hover:bg-purple-500/20 rounded-lg transition disabled:opacity-50"
                      title="AI ile analiz et">
                      {analyzingUid === u.uid ? <span className="w-3 h-3 border-2 border-purple-300 border-t-purple-600 rounded-full animate-spin block" /> : "🤖"}
                    </button>
                    <button onClick={() => setBanModal(u)} className="px-2.5 py-1.5 text-xs font-semibold bg-orange-500/10 text-orange-600 dark:text-orange-400 hover:bg-orange-500/20 rounded-lg transition">🚫 Banla</button>
                    <button onClick={() => deleteUser(u)} className="px-2.5 py-1.5 text-xs font-semibold bg-destructive/10 text-destructive hover:bg-destructive/20 rounded-lg transition">🗑️</button>
                  </div>
                </div>
              ))}
              {filteredUsers.filter(u => !u.banned).length === 0 && (
                <div className="text-center py-12 text-muted-foreground text-sm">Kullanıcı bulunamadı</div>
              )}
            </div>
          </div>
        )}

        {/* CHAT LOGS */}
        {tab === "logs" && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-foreground">Sohbet Logları</h2>
            {!selectedConv ? (
              <div className="space-y-2">
                {convs.map(c => {
                  const u1 = getUserById(c.participants[0]);
                  const u2 = getUserById(c.participants[1]);
                  return (
                    <button key={c.id} onClick={() => loadConvMessages(c)}
                      className="w-full flex items-center gap-3 bg-card border border-border rounded-xl px-4 py-3 text-left hover:border-primary/50 transition">
                      <div className="flex -space-x-2"><Avatar user={u1 ?? null} size={32} /><Avatar user={u2 ?? null} size={32} /></div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">{u1?.displayUsername || u1?.username || "?"} ↔ {u2?.displayUsername || u2?.username || "?"}</p>
                        {c.lastMessage && <p className="text-xs text-muted-foreground truncate">{c.lastMessage}</p>}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs font-semibold text-primary">{c.msgCount} mesaj</p>
                        <p className="text-xs text-muted-foreground">{formatDate(c.lastMessageAt)}</p>
                      </div>
                    </button>
                  );
                })}
                {convs.length === 0 && <div className="text-center py-12 text-muted-foreground text-sm">Henüz sohbet yok</div>}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <button onClick={() => setSelectedConv(null)} className="p-1.5 rounded-lg hover:bg-muted transition text-muted-foreground">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                  </button>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">
                      {getUserById(selectedConv.participants[0])?.displayUsername || "?"} ↔ {getUserById(selectedConv.participants[1])?.displayUsername || "?"}
                    </h3>
                    <p className="text-xs text-muted-foreground">{convMessages.length} mesaj</p>
                  </div>
                </div>

                {/* Messages */}
                {loadingLogs
                  ? <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-muted border-t-primary rounded-full animate-spin" /></div>
                  : (
                    <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
                      {convMessages.map(msg => {
                        const isSystem = msg.senderId === "SYSTEM" || msg.type === "system";
                        const sender = !isSystem ? getUserById(msg.senderId) : null;
                        if (isSystem) {
                          return (
                            <div key={msg.id} className="flex items-center gap-2 justify-center">
                              <div className="flex-1 bg-amber-500/10 border border-amber-500/25 rounded-xl px-4 py-2.5 text-center">
                                <span className="text-xs font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wide mr-2">⚙️ SİSTEM UYARISI</span>
                                <span className="text-sm text-foreground">{msg.text}</span>
                              </div>
                              <button onClick={() => deleteConvMsg(selectedConv.id, msg.id)} className="p-1 rounded text-muted-foreground hover:text-destructive shrink-0">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                              </button>
                            </div>
                          );
                        }
                        return (
                          <div key={msg.id} className="flex items-start gap-3 bg-card border border-border rounded-xl px-3 py-2.5">
                            <Avatar user={sender ?? null} size={28} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-baseline gap-2">
                                <span className="text-xs font-semibold text-foreground">@{sender?.username || "?"}</span>
                                {sender?.verified && <VerifiedBadge size={11} />}
                                <span className="text-xs text-muted-foreground">{formatDate(msg.createdAt)}</span>
                              </div>
                              <p className="text-sm text-foreground mt-0.5 break-words">{msg.text}</p>
                            </div>
                            <button onClick={() => deleteConvMsg(selectedConv.id, msg.id)} className="p-1 rounded text-muted-foreground hover:text-destructive shrink-0">
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                            </button>
                          </div>
                        );
                      })}
                      {convMessages.length === 0 && <div className="text-center py-8 text-muted-foreground text-sm">Bu sohbette mesaj yok</div>}
                    </div>
                  )
                }

                {/* ⚙️ SYSTEM INJECTION BOX */}
                <div className="bg-amber-500/8 border border-amber-500/25 rounded-xl p-4 mt-2">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-base">⚙️</span>
                    <p className="text-sm font-bold text-amber-600 dark:text-amber-400">Sistem Müdahalesi</p>
                    <span className="text-xs text-muted-foreground ml-1">— bu sohbete SİSTEM olarak mesaj gönder</span>
                  </div>
                  <div className="flex gap-2">
                    <input type="text" value={sysMsg} onChange={e => setSysMsg(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && sendSystemMessage()}
                      placeholder="Örn: Bu kullanıcı şüpheli hareketler nedeniyle izlenmektedir..."
                      className="flex-1 px-3.5 py-2.5 rounded-lg border border-amber-500/30 bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-amber-500/50 transition" />
                    <button onClick={sendSystemMessage} disabled={!sysMsg.trim() || sendingSys}
                      className="px-4 py-2.5 bg-amber-500 text-white text-sm font-semibold rounded-lg hover:bg-amber-600 transition disabled:opacity-40 shrink-0">
                      {sendingSys ? "..." : "Gönder"}
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">Mesaj her iki kullanıcıya da sarı SİSTEM uyarısı olarak görünür.</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* BANNED */}
        {tab === "banned" && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-foreground">Banlı Kullanıcılar</h2>
            {filteredUsers.filter(u => u.banned).length === 0
              ? <div className="text-center py-16 text-muted-foreground"><div className="text-4xl mb-3">✅</div><p className="text-sm">Banlı kullanıcı yok</p></div>
              : filteredUsers.filter(u => u.banned).map(u => (
                <div key={u.uid} className="flex items-center gap-3 bg-destructive/5 border border-destructive/20 rounded-xl px-4 py-3">
                  <Avatar user={u} size={36} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-foreground">{u.displayUsername || u.username}</p>
                      {u.verified && <VerifiedBadge size={14} />}
                      <span className="text-xs bg-destructive/15 text-destructive px-1.5 py-0.5 rounded-md font-medium">banlı</span>
                      {u.aiLabel && <AiLabelBadge label={u.aiLabel} />}
                    </div>
                    <p className="text-xs text-muted-foreground">{u.email}</p>
                    {u.banReason && <p className="text-xs text-destructive/80 mt-0.5">Sebep: {u.banReason}</p>}
                  </div>
                  <button onClick={() => unbanUser(u)} className="px-3 py-1.5 text-xs font-semibold bg-green-500/10 text-green-600 dark:text-green-400 hover:bg-green-500/20 rounded-lg transition shrink-0">✅ Banı Kaldır</button>
                </div>
              ))
            }
          </div>
        )}
      </div>

      {/* BAN MODAL */}
      {banModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={e => e.target === e.currentTarget && setBanModal(null)}>
          <div className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-sm p-6">
            <div className="flex items-center gap-3 mb-4"><Avatar user={banModal} size={40} />
              <div><p className="text-sm font-bold text-foreground">{banModal.displayUsername || banModal.username}</p><p className="text-xs text-muted-foreground">@{banModal.username}</p></div>
            </div>
            <h3 className="text-base font-bold text-foreground mb-1">Kullanıcıyı Banla</h3>
            <p className="text-xs text-muted-foreground mb-4">Bu kullanıcı uygulamaya giremeyecek.</p>
            <div className="mb-4">
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Ban Sebebi (opsiyonel)</label>
              <input type="text" value={banReason} onChange={e => setBanReason(e.target.value)} placeholder="ör: Spam, kural ihlali..."
                className="w-full px-3.5 py-2.5 rounded-lg border border-input bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition" />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setBanModal(null)} className="flex-1 py-2.5 rounded-lg bg-muted text-muted-foreground text-sm font-semibold hover:bg-accent transition">İptal</button>
              <button onClick={() => banUser(banModal, banReason)} className="flex-1 py-2.5 rounded-lg bg-destructive text-destructive-foreground text-sm font-semibold hover:opacity-90 transition">🚫 Banla</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
