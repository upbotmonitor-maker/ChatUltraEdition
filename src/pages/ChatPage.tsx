import { useState, useEffect, useRef, useCallback } from "react";
import {
  collection, doc, getDoc, query, orderBy,
  onSnapshot, addDoc, serverTimestamp, setDoc, updateDoc,
  Timestamp, deleteField,
} from "firebase/firestore";
import { signOut, updateProfile } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import EmojiPicker, { Theme, EmojiClickData } from "emoji-picker-react";

const IMGBB_KEY = import.meta.env.VITE_IMGBB_API_KEY;
const GIPHY_KEY = "dc6zaTOxFJmzC";
const MAX_CHARS = 400;
const RATE_LIMIT_MS = 1000;
const MUTE_DURATION_MS = 5 * 60 * 1000;

// ─── CAPTCHA ───────────────────────────────────────────────────────────────
function generateCaptcha(): { question: string; answer: string } {
  const type = Math.random() < 0.5 ? "math" : "text";
  if (type === "math") {
    const a = Math.floor(Math.random() * 20) + 1;
    const b = Math.floor(Math.random() * 20) + 1;
    const ops = [
      { op: "+", result: a + b },
      { op: "-", result: a - b },
      { op: "×", result: a * b },
    ];
    const chosen = ops[Math.floor(Math.random() * ops.length)];
    return { question: `${a} ${chosen.op} ${b} = ?`, answer: String(chosen.result) };
  } else {
    const words = [
      { q: "Türkiye'nin başkenti neresidir?", a: "ankara" },
      { q: "Bir haftada kaç gün vardır?", a: "7" },
      { q: "Gökyüzünün rengi nedir?", a: "mavi" },
      { q: "Bir yılda kaç ay vardır?", a: "12" },
      { q: "Güneş hangi yönden doğar?", a: "doğu" },
      { q: "İnsanın kaç eli vardır?", a: "2" },
      { q: "Su kaç derecede kaynar?", a: "100" },
    ];
    const chosen = words[Math.floor(Math.random() * words.length)];
    return { question: chosen.q, answer: chosen.a };
  }
}

function CaptchaModal({ onPass }: { onPass: () => void }) {
  const [captcha] = useState(generateCaptcha);
  const [input, setInput] = useState("");
  const [error, setError] = useState(false);
  const [shake, setShake] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const userAnswer = input.trim().toLowerCase();
    const correct = captcha.answer.toLowerCase();
    if (userAnswer === correct) {
      localStorage.setItem("cf_captcha_passed", "1");
      onPass();
    } else {
      setError(true);
      setShake(true);
      setInput("");
      setTimeout(() => setShake(false), 600);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className={`bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm p-6 ${shake ? "animate-bounce" : ""}`}>
        <div className="text-center mb-5">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-primary/15 mb-3">
            <span className="text-2xl">🤖</span>
          </div>
          <h2 className="text-lg font-bold text-foreground">İnsan Doğrulama</h2>
          <p className="text-sm text-muted-foreground mt-1">Mesaj atmadan önce lütfen aşağıdaki soruyu yanıtla.</p>
        </div>
        <div className="bg-muted rounded-xl p-4 mb-4 text-center">
          <p className="text-lg font-bold text-foreground">{captcha.question}</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="text"
            value={input}
            onChange={e => { setInput(e.target.value); setError(false); }}
            placeholder="Cevabını yaz..."
            autoFocus
            className={`w-full px-3.5 py-2.5 rounded-xl border text-sm text-foreground bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition ${error ? "border-destructive ring-2 ring-destructive/30" : "border-input"}`}
          />
          {error && <p className="text-xs text-destructive text-center">Yanlış cevap, tekrar dene!</p>}
          <button
            type="submit"
            disabled={!input.trim()}
            className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition disabled:opacity-40"
          >
            Doğrula ve Devam Et
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── TYPES ─────────────────────────────────────────────────────────────────
interface UserData {
  uid: string;
  username: string;
  displayUsername: string;
  email: string;
  photoURL: string;
  createdAt: number;
  online?: boolean;
  lastSeen?: number;
  verified?: boolean;
  mutedUntil?: number;
}

interface Message {
  id: string;
  senderId: string;
  text?: string;
  type?: "text" | "audio" | "image" | "gif" | "system";
  audioData?: string;
  imageUrl?: string;
  gifUrl?: string;
  createdAt: Timestamp | null;
}

// ─── HELPERS ───────────────────────────────────────────────────────────────
function getConvId(uid1: string, uid2: string) {
  return [uid1, uid2].sort().join("_");
}

function VerifiedBadge({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="inline-block flex-shrink-0" aria-label="Resmi Doğrulanmış Hesap">
      <path d="M12 1L3 5v6c0 5.25 3.75 10.16 9 11.25C17.25 21.16 21 16.25 21 11V5L12 1z" fill="#3b82f6" />
      <path d="M9 12l2 2 4-4" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </svg>
  );
}

function Avatar({ user, size = 36 }: { user: UserData | null; size?: number }) {
  if (user?.photoURL) {
    return <img src={user.photoURL} alt={user?.displayUsername} style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />;
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

function formatTime(ts: Timestamp | null) {
  if (!ts) return "";
  const d = ts.toDate();
  const now = new Date();
  const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (diffMin < 1) return d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
  if (diffMin < 60) return `${diffMin}dk`;
  if (diffMin < 1440) return `${Math.floor(diffMin / 60)}s`;
  return d.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit" });
}

function formatLastSeen(online: boolean | undefined, lastSeen: number | undefined): { text: string; color: string } {
  if (online) return { text: "çevrimiçi", color: "#22c55e" };
  if (!lastSeen) return { text: "son görülme bilinmiyor", color: "#9ca3af" };
  const diffMs = Date.now() - lastSeen;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return { text: "az önce görüldü", color: "#9ca3af" };
  if (diffMin < 60) return { text: `${diffMin} dakika önce`, color: "#9ca3af" };
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return { text: `${diffH} saat önce`, color: "#9ca3af" };
  const d = new Date(lastSeen);
  return { text: `${d.toLocaleDateString("tr-TR")} tarihinde`, color: "#9ca3af" };
}

function TypingDots() {
  return (
    <span className="inline-flex items-end gap-[3px] h-3">
      {[0, 1, 2].map(i => (
        <span key={i} className="w-1.5 h-1.5 rounded-full bg-current opacity-70 animate-bounce"
          style={{ animationDelay: `${i * 0.15}s`, animationDuration: "0.8s" }} />
      ))}
    </span>
  );
}

function AudioPlayer({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) { a.pause(); setPlaying(false); }
    else { a.play(); setPlaying(true); }
  };

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  return (
    <div className="flex items-center gap-2 min-w-[180px]">
      <audio ref={audioRef} src={src}
        onTimeUpdate={e => setProgress(e.currentTarget.currentTime)}
        onDurationChange={e => setDuration(e.currentTarget.duration)}
        onEnded={() => { setPlaying(false); setProgress(0); if (audioRef.current) audioRef.current.currentTime = 0; }}
      />
      <button onClick={toggle} className="w-8 h-8 rounded-full flex items-center justify-center bg-white/20 hover:bg-white/30 transition shrink-0">
        {playing
          ? <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
          : <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        }
      </button>
      <div className="flex-1">
        <input type="range" min="0" max={duration || 1} step="0.1" value={progress}
          onChange={e => { if (audioRef.current) { audioRef.current.currentTime = +e.target.value; setProgress(+e.target.value); } }}
          className="w-full h-1 rounded-full accent-white cursor-pointer"
        />
        <p className="text-[10px] mt-0.5 opacity-70">{fmt(progress)} / {fmt(duration)}</p>
      </div>
    </div>
  );
}

// ─── MAIN COMPONENT ─────────────────────────────────────────────────────────
export default function ChatPage() {
  const me = auth.currentUser!;

  const [myData, setMyData] = useState<UserData | null>(null);
  const [users, setUsers] = useState<UserData[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserData | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [search, setSearch] = useState("");
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const [showEmoji, setShowEmoji] = useState(false);
  const [showGif, setShowGif] = useState(false);
  const [gifSearch, setGifSearch] = useState("");
  const [gifResults, setGifResults] = useState<Array<{ id: string; url: string; preview: string }>>([]);
  const [gifLoading, setGifLoading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSecs, setRecordSecs] = useState(0);
  const [sendingImg, setSendingImg] = useState(false);
  const [lightboxImg, setLightboxImg] = useState<string | null>(null);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [peerTyping, setPeerTyping] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  // ── Security states ─────────────────────────────────────────────────────
  const [captchaDone, setCaptchaDone] = useState(() => localStorage.getItem("cf_captcha_passed") === "1");
  const [showCaptcha, setShowCaptcha] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [muteSecondsLeft, setMuteSecondsLeft] = useState(0);
  const lastSentAtRef = useRef<number>(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const emojiRef = useRef<HTMLDivElement>(null);
  const gifRef = useRef<HTMLDivElement>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedUserRef = useRef<UserData | null>(null);
  const convsInitializedRef = useRef(false);
  const muteTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { selectedUserRef.current = selectedUser; }, [selectedUser]);

  // ── Theme ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (dark) { document.documentElement.classList.add("dark"); localStorage.setItem("chatfire-theme", "dark"); }
    else { document.documentElement.classList.remove("dark"); localStorage.setItem("chatfire-theme", "light"); }
  }, [dark]);

  // ── Mute countdown from Firestore ─────────────────────────────────────
  useEffect(() => {
    return onSnapshot(doc(db, "users", me.uid), snap => {
      if (!snap.exists()) return;
      const data = snap.data() as UserData;
      setMyData(data);
      const muteUntil = data.mutedUntil ?? 0;
      const remaining = muteUntil - Date.now();
      if (remaining > 0) {
        setIsMuted(true);
        setMuteSecondsLeft(Math.ceil(remaining / 1000));
        if (muteTimerRef.current) clearInterval(muteTimerRef.current);
        muteTimerRef.current = setInterval(() => {
          setMuteSecondsLeft(prev => {
            if (prev <= 1) {
              clearInterval(muteTimerRef.current!);
              setIsMuted(false);
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      } else {
        setIsMuted(false);
        setMuteSecondsLeft(0);
      }
    });
  }, [me.uid]);

  // ── Presence ──────────────────────────────────────────────────────────
  useEffect(() => {
    const setOnline = () => updateDoc(doc(db, "users", me.uid), { online: true, lastSeen: Date.now() }).catch(() => {});
    const setOffline = () => updateDoc(doc(db, "users", me.uid), { online: false, lastSeen: Date.now() }).catch(() => {});
    setOnline();
    const interval = setInterval(setOnline, 30000);
    const onHide = () => document.hidden ? setOffline() : setOnline();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", setOffline);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", setOffline);
      setOffline();
    };
  }, [me.uid]);

  // ── All users (realtime) ───────────────────────────────────────────────
  useEffect(() => {
    return onSnapshot(collection(db, "users"), snap => {
      const list: UserData[] = [];
      snap.forEach(d => { const u = d.data() as UserData; if (u.uid !== me.uid && !u.banned) list.push(u); });
      list.sort((a, b) => {
        if (a.online && !b.online) return -1;
        if (!a.online && b.online) return 1;
        return (a.displayUsername || a.username).localeCompare(b.displayUsername || b.username);
      });
      setUsers(list);
    });
  }, [me.uid]);

  // ── Unread counts ──────────────────────────────────────────────────────
  useEffect(() => {
    return onSnapshot(collection(db, "conversations"), snap => {
      if (!convsInitializedRef.current) { convsInitializedRef.current = true; return; }
      snap.docChanges().forEach(change => {
        if (change.type !== "modified") return;
        const data = change.doc.data();
        if (!data.participants?.includes(me.uid)) return;
        if (data.lastSenderId === me.uid) return;
        const otherUid = data.participants.find((p: string) => p !== me.uid);
        if (!otherUid) return;
        if (selectedUserRef.current?.uid === otherUid) return;
        setUnreadCounts(prev => ({ ...prev, [otherUid]: (prev[otherUid] || 0) + 1 }));
      });
    });
  }, [me.uid]);

  // ── Messages for selected conversation ────────────────────────────────
  useEffect(() => {
    if (!selectedUser) return;
    const convId = getConvId(me.uid, selectedUser.uid);
    const q = query(collection(db, "conversations", convId, "messages"), orderBy("createdAt", "asc"));
    return onSnapshot(q, snap => {
      const msgs: Message[] = [];
      snap.forEach(d => msgs.push({ id: d.id, ...(d.data() as Omit<Message, "id">) }));
      setMessages(msgs);
    });
  }, [selectedUser, me.uid]);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  // ── Typing listener ────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedUser) { setPeerTyping(false); return; }
    const convId = getConvId(me.uid, selectedUser.uid);
    const peerUid = selectedUser.uid;
    return onSnapshot(doc(db, "typing", convId), snap => {
      if (!snap.exists()) { setPeerTyping(false); return; }
      const ts = snap.data()?.[peerUid] as number | undefined;
      setPeerTyping(!!ts && Date.now() - ts < 4000);
    });
  }, [selectedUser, me.uid]);

  // ── Close emoji / GIF on outside click ────────────────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (emojiRef.current && !emojiRef.current.contains(e.target as Node)) setShowEmoji(false);
      if (gifRef.current && !gifRef.current.contains(e.target as Node)) setShowGif(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ── Clear my typing status on conv change ─────────────────────────────
  useEffect(() => {
    return () => {
      if (selectedUser) {
        const convId = getConvId(me.uid, selectedUser.uid);
        updateDoc(doc(db, "typing", convId), { [me.uid]: deleteField() }).catch(() => {});
      }
    };
  }, [selectedUser, me.uid]);

  // ── Mute timer cleanup ────────────────────────────────────────────────
  useEffect(() => {
    return () => { if (muteTimerRef.current) clearInterval(muteTimerRef.current); };
  }, []);

  const openChat = (user: UserData) => {
    if (selectedUser) {
      const oldConvId = getConvId(me.uid, selectedUser.uid);
      updateDoc(doc(db, "typing", oldConvId), { [me.uid]: deleteField() }).catch(() => {});
    }
    setSelectedUser(user);
    setMessages([]);
    setShowSidebar(false);
    setShowEmoji(false);
    setPeerTyping(false);
    setUnreadCounts(prev => ({ ...prev, [user.uid]: 0 }));
  };

  // ── Core send function ─────────────────────────────────────────────────
  const sendMsg = async (payload: Partial<Message>) => {
    if (!selectedUser) return;
    const convId = getConvId(me.uid, selectedUser.uid);
    const convRef = doc(db, "conversations", convId);
    const snap = await getDoc(convRef);
    if (!snap.exists()) await setDoc(convRef, { participants: [me.uid, selectedUser.uid], createdAt: serverTimestamp() });
    await addDoc(collection(db, "conversations", convId, "messages"), { senderId: me.uid, createdAt: serverTimestamp(), ...payload });
    const preview = payload.text || (payload.type === "audio" ? "🎤 Sesli mesaj" : "🖼️ Görsel");
    await updateDoc(convRef, { lastMessage: preview, lastMessageAt: serverTimestamp(), lastSenderId: me.uid });
    updateDoc(doc(db, "typing", convId), { [me.uid]: deleteField() }).catch(() => {});
  };

  // ── Rate-limited text send ─────────────────────────────────────────────
  const sendTextMessage = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || !selectedUser || sending) return;

    // ① Captcha check — show modal on first message
    if (!captchaDone) {
      setShowCaptcha(true);
      return;
    }

    // ② Mute check
    if (isMuted) return;

    // ③ 400-char limit
    if (text.trim().length > MAX_CHARS) return;

    // ④ Rate limit: 1 msg/sec
    const now = Date.now();
    const elapsed = now - lastSentAtRef.current;
    if (elapsed < RATE_LIMIT_MS) {
      // Violation → mute for 5 minutes
      const muteUntil = now + MUTE_DURATION_MS;
      await updateDoc(doc(db, "users", me.uid), { mutedUntil: muteUntil }).catch(() => {});
      return;
    }
    lastSentAtRef.current = now;

    const t = text.trim();
    setText("");
    setSending(true);
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    try { await sendMsg({ type: "text", text: t }); } finally { setSending(false); }
  }, [text, selectedUser, sending, captchaDone, isMuted]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendTextMessage(e as unknown as React.FormEvent); }
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    if (val.length > MAX_CHARS) return; // block over-limit typing
    setText(val);
    if (!selectedUser) return;
    const convId = getConvId(me.uid, selectedUser.uid);
    const ref = doc(db, "typing", convId);
    setDoc(ref, { [me.uid]: Date.now() }, { merge: true }).catch(() => {});
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      updateDoc(ref, { [me.uid]: deleteField() }).catch(() => {});
    }, 2000);
  };

  const onEmojiClick = (emojiData: EmojiClickData) => {
    const ta = textareaRef.current;
    if (!ta) { setText(t => t + emojiData.emoji); return; }
    const start = ta.selectionStart ?? text.length;
    const end = ta.selectionEnd ?? text.length;
    const newText = text.slice(0, start) + emojiData.emoji + text.slice(end);
    if (newText.length > MAX_CHARS) return;
    setText(newText);
    setTimeout(() => { ta.focus(); ta.setSelectionRange(start + emojiData.emoji.length, start + emojiData.emoji.length); }, 0);
  };

  // ── GIF search & send ─────────────────────────────────────────────────
  const searchGifs = useCallback(async (q: string) => {
    setGifLoading(true);
    try {
      const endpoint = q.trim()
        ? `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_KEY}&q=${encodeURIComponent(q)}&limit=18&rating=g&lang=tr`
        : `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_KEY}&limit=18&rating=g`;
      const res = await fetch(endpoint);
      const json = await res.json();
      const items = (json.data ?? []).map((g: Record<string, unknown>) => {
        const images = g.images as Record<string, { url: string }>;
        return {
          id: g.id as string,
          url: images?.original?.url ?? "",
          preview: images?.fixed_width_small?.url ?? images?.fixed_width?.url ?? images?.original?.url ?? "",
        };
      });
      setGifResults(items);
    } catch { /* silently fail */ }
    setGifLoading(false);
  }, []);

  const openGifPanel = () => {
    setShowEmoji(false);
    setShowGif(v => {
      if (!v) { searchGifs(gifSearch); }
      return !v;
    });
  };

  const sendGif = async (gifUrl: string) => {
    if (!selectedUser || !captchaDone) return;
    setShowGif(false);
    await sendMsg({ type: "gif", gifUrl });
  };

  // ── Recording ──────────────────────────────────────────────────────────
  const stopRecording = () => {
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    mediaRecorderRef.current?.stop();
    setRecording(false);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm" });
      audioChunksRef.current = [];
      mr.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        if (blob.size > 800000) { alert("Ses kaydı çok uzun! Maks 30 saniye kayıt yapabilirsiniz."); return; }
        const reader = new FileReader();
        reader.onloadend = async () => { await sendMsg({ type: "audio", audioData: reader.result as string }); };
        reader.readAsDataURL(blob);
      };
      mr.start(100);
      mediaRecorderRef.current = mr;
      setRecording(true);
      setRecordSecs(0);
      recordTimerRef.current = setInterval(() => setRecordSecs(s => {
        if (s >= 59) { stopRecording(); return 60; }
        return s + 1;
      }), 1000);
    } catch { alert("Mikrofon erişimi reddedildi."); }
  };

  // ── Image upload ───────────────────────────────────────────────────────
  const handleImgUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!IMGBB_KEY) { alert("Görsel yükleme için VITE_IMGBB_API_KEY gerekli."); return; }
    setSendingImg(true);
    try {
      const formData = new FormData();
      formData.append("image", file);
      const res = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_KEY}`, { method: "POST", body: formData });
      const json = await res.json();
      if (json.success) { await sendMsg({ type: "image", imageUrl: json.data.url }); }
      else { alert("Görsel yüklenemedi."); }
    } catch { alert("Görsel yüklenirken hata oluştu."); }
    finally { setSendingImg(false); if (imgInputRef.current) imgInputRef.current.value = ""; }
  };

  // ── Profile photo upload ───────────────────────────────────────────────
  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !IMGBB_KEY) return;
    setUploadingPhoto(true);
    try {
      const formData = new FormData();
      formData.append("image", file);
      const res = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_KEY}`, { method: "POST", body: formData });
      const json = await res.json();
      if (json.success) {
        const url = json.data.url;
        await updateProfile(me, { photoURL: url });
        await updateDoc(doc(db, "users", me.uid), { photoURL: url });
      }
    } catch { alert("Fotoğraf yüklenirken hata oluştu."); }
    finally { setUploadingPhoto(false); if (fileInputRef.current) fileInputRef.current.value = ""; }
  };

  const getHeaderStatus = () => {
    if (!selectedUser) return null;
    if (peerTyping) return (
      <span className="text-xs text-primary flex items-center gap-1">
        <TypingDots /> <span>yazıyor...</span>
      </span>
    );
    const status = formatLastSeen(selectedUser.online, selectedUser.lastSeen);
    return <span className="text-xs" style={{ color: status.color }}>{status.text}</span>;
  };

  const filteredUsers = users.filter(u =>
    (u.displayUsername || u.username).toLowerCase().includes(search.toLowerCase())
  );

  const charsLeft = MAX_CHARS - text.length;
  const isOverLimit = text.length > MAX_CHARS;

  // ── Mute countdown display ─────────────────────────────────────────────
  const muteMinutes = Math.floor(muteSecondsLeft / 60);
  const muteSecs = muteSecondsLeft % 60;

  return (
    <div className="h-screen flex overflow-hidden bg-background">
      {/* Captcha modal */}
      {showCaptcha && (
        <CaptchaModal onPass={() => { setCaptchaDone(true); setShowCaptcha(false); }} />
      )}

      {/* SIDEBAR */}
      <div className={`${showSidebar ? "flex" : "hidden"} md:flex flex-col w-full md:w-72 lg:w-80 border-r border-border bg-sidebar shrink-0`}>
        {/* Sidebar header */}
        <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-sidebar-border">
          <div className="relative cursor-pointer" onClick={() => fileInputRef.current?.click()} title="Profil fotoğrafı değiştir">
            <Avatar user={myData} size={32} />
            {uploadingPhoto && (
              <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center">
                <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin block" />
              </div>
            )}
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1">
              <p className="text-sm font-semibold text-sidebar-foreground truncate">{myData?.displayUsername || myData?.username || "..."}</p>
              {myData?.verified && <VerifiedBadge size={13} />}
            </div>
            <p className="text-xs text-muted-foreground truncate">@{myData?.username || "..."}</p>
          </div>
          <button onClick={() => setDark(d => !d)} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors" title="Tema değiştir">
            {dark
              ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
              : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
            }
          </button>
          <button data-testid="button-logout" onClick={() => signOut(auth)}
            className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors" title="Çıkış Yap">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          </button>
        </div>

        {/* Search */}
        <div className="px-3 py-2.5 border-b border-sidebar-border">
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Kullanıcı ara..."
              className="w-full pl-8 pr-3 py-2 text-xs rounded-lg border border-sidebar-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
            />
          </div>
        </div>

        {/* User list */}
        <div className="flex-1 overflow-y-auto py-1.5">
          {filteredUsers.length === 0 && (
            <div className="text-center text-xs text-muted-foreground py-8">Kullanıcı bulunamadı</div>
          )}
          {filteredUsers.map(u => (
            <button key={u.uid} onClick={() => openChat(u)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 hover:bg-sidebar-accent transition-colors text-left ${selectedUser?.uid === u.uid ? "bg-sidebar-accent" : ""}`}>
              <div className="relative shrink-0">
                <Avatar user={u} size={36} />
                <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-sidebar" style={{ background: u.online ? "#22c55e" : "#9ca3af" }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1">
                  <div className="flex items-center gap-1 min-w-0">
                    <span className="text-sm font-medium text-sidebar-foreground truncate">{u.displayUsername || u.username}</span>
                    {u.verified && <VerifiedBadge size={12} />}
                  </div>
                  {unreadCounts[u.uid] > 0 && (
                    <span className="ml-1 min-w-[18px] h-[18px] rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center px-1 shrink-0">
                      {unreadCounts[u.uid]}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate">{u.online ? "çevrimiçi" : "@" + u.username}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* CHAT AREA */}
      <div className={`flex-1 flex flex-col min-w-0 ${!showSidebar ? "flex" : "hidden"} md:flex`}>
        {!selectedUser ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 px-4">
            <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center text-3xl">💬</div>
            <h2 className="text-lg font-semibold text-foreground">Sohbet başlat</h2>
            <p className="text-sm text-muted-foreground max-w-xs">Soldan bir kullanıcı seç ve sohbet etmeye başla.</p>
          </div>
        ) : (
          <>
            {/* Chat header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card shadow-sm">
              <button data-testid="button-back" onClick={() => setShowSidebar(true)} className="md:hidden p-1.5 rounded-md text-muted-foreground hover:bg-accent transition-colors">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
              </button>
              <div className="relative shrink-0">
                <Avatar user={selectedUser} size={36} />
                <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-card" style={{ background: selectedUser.online ? "#22c55e" : "#9ca3af" }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p data-testid="text-chat-user" className="text-sm font-semibold text-foreground truncate">{selectedUser.displayUsername || selectedUser.username}</p>
                  {selectedUser.verified && <VerifiedBadge size={14} />}
                </div>
                <div className="h-4 flex items-center">{getHeaderStatus()}</div>
              </div>
            </div>

            {/* Mute banner */}
            {isMuted && (
              <div className="bg-destructive/10 border-b border-destructive/20 px-4 py-2 flex items-center gap-2">
                <span className="text-destructive text-sm">🔇</span>
                <p className="text-xs text-destructive font-medium flex-1">
                  Hız sınırını aştığın için {muteMinutes}:{String(muteSecs).padStart(2, "0")} süreyle susturuldun.
                </p>
              </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-0.5">
              {messages.length === 0 && (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <div className="text-3xl mb-2">👋</div>
                    <p className="text-sm text-muted-foreground"><span className="font-medium text-foreground">{selectedUser.displayUsername || selectedUser.username}</span> ile sohbet başladı</p>
                    <p className="text-xs text-muted-foreground mt-1">İlk mesajı sen at!</p>
                  </div>
                </div>
              )}
              {messages.map((msg, i) => {
                if (msg.senderId === "SYSTEM" || msg.type === "system") {
                  return (
                    <div key={msg.id} className="flex justify-center my-3 px-2 msg-animate">
                      <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl px-4 py-2.5 max-w-md w-full">
                        <div className="flex items-center justify-center gap-1.5 mb-1">
                          <span className="text-sm">⚙️</span>
                          <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-widest">SİSTEM UYARISI</span>
                        </div>
                        <p className="text-sm text-foreground text-center leading-snug">{msg.text}</p>
                        {msg.createdAt && (
                          <p className="text-[10px] text-muted-foreground text-center mt-1">{formatTime(msg.createdAt)}</p>
                        )}
                      </div>
                    </div>
                  );
                }

                const isMine = msg.senderId === me.uid;
                const prevMsg = messages[i - 1];
                const showTime = !prevMsg || (msg.createdAt && prevMsg.createdAt && (msg.createdAt.toMillis() - prevMsg.createdAt.toMillis()) > 5 * 60 * 1000);
                return (
                  <div key={msg.id}>
                    {showTime && msg.createdAt && (
                      <div className="flex justify-center my-3">
                        <span className="text-xs text-muted-foreground bg-muted px-3 py-0.5 rounded-full">
                          {msg.createdAt.toDate().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                    )}
                    <div data-testid={`msg-${msg.id}`} className={`flex msg-animate ${isMine ? "justify-end" : "justify-start"} mb-0.5`}>
                      {!isMine && <div className="mr-2 self-end mb-0.5 shrink-0"><Avatar user={selectedUser} size={24} /></div>}
                      <div className={`max-w-[72%] px-3.5 py-2 rounded-2xl text-sm leading-relaxed break-words ${isMine ? "bg-primary text-primary-foreground rounded-br-sm" : "bg-card border border-border text-card-foreground rounded-bl-sm"}`}>
                        {(!msg.type || msg.type === "text") && <span>{msg.text}</span>}
                        {msg.type === "audio" && msg.audioData && <AudioPlayer src={msg.audioData} />}
                        {msg.type === "image" && msg.imageUrl && (
                          <div>
                            <img src={msg.imageUrl} alt="Görsel" className="rounded-xl max-w-full cursor-pointer hover:opacity-90 transition" style={{ maxHeight: 300, display: "block" }} onClick={() => setLightboxImg(msg.imageUrl!)} />
                            <span className="text-[11px] mt-1 block opacity-70">🖼️ Görsel</span>
                          </div>
                        )}
                        {msg.type === "gif" && msg.gifUrl && (
                          <div>
                            <img src={msg.gifUrl} alt="GIF" className="rounded-xl max-w-full cursor-pointer hover:opacity-90 transition" style={{ maxHeight: 280, display: "block" }} onClick={() => setLightboxImg(msg.gifUrl!)} />
                          </div>
                        )}
                        <span className={`block text-[10px] mt-0.5 text-right ${isMine ? "text-primary-foreground/60" : "text-[#9ca3af]"}`}>{formatTime(msg.createdAt)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
              {peerTyping && (
                <div className="flex justify-start mb-0.5">
                  <div className="mr-2 self-end mb-0.5 shrink-0"><Avatar user={selectedUser} size={24} /></div>
                  <div className="px-4 py-3 rounded-2xl rounded-bl-sm bg-card border border-border flex items-center gap-1">
                    <TypingDots />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input area */}
            <div className="px-3 py-3 border-t border-border bg-card relative">
              {showEmoji && (
                <div ref={emojiRef} className="absolute bottom-full mb-2 left-3 z-50">
                  <EmojiPicker
                    onEmojiClick={onEmojiClick}
                    theme={dark ? Theme.DARK : Theme.LIGHT}
                    lazyLoadEmojis
                    searchPlaceholder="Emoji ara..."
                    height={380}
                    width={320}
                  />
                </div>
              )}

              {showGif && (
                <div ref={gifRef} className="absolute bottom-full mb-2 left-3 z-50 w-80 rounded-2xl border border-border bg-card shadow-xl overflow-hidden flex flex-col">
                  <div className="p-2 border-b border-border flex items-center gap-2">
                    <input
                      autoFocus
                      value={gifSearch}
                      onChange={e => { setGifSearch(e.target.value); }}
                      onKeyDown={e => { if (e.key === "Enter") searchGifs(gifSearch); }}
                      placeholder="GIF ara... (örn: stick war, funny)"
                      className="flex-1 px-3 py-1.5 text-sm rounded-xl border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <button onClick={() => searchGifs(gifSearch)}
                      className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-primary text-primary-foreground hover:opacity-90 transition">
                      Ara
                    </button>
                  </div>
                  <div className="h-72 overflow-y-auto p-2">
                    {gifLoading ? (
                      <div className="flex items-center justify-center h-full">
                        <span className="border-2 border-muted border-t-primary rounded-full animate-spin block w-8 h-8" />
                      </div>
                    ) : gifResults.length === 0 ? (
                      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">Sonuç yok</div>
                    ) : (
                      <div className="grid grid-cols-3 gap-1.5">
                        {gifResults.map(g => (
                          <button key={g.id} onClick={() => sendGif(g.url)}
                            className="relative rounded-lg overflow-hidden aspect-square bg-muted hover:opacity-80 transition hover:ring-2 hover:ring-primary">
                            <img src={g.preview} alt="gif" className="w-full h-full object-cover" loading="lazy" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="px-2 py-1 border-t border-border text-[10px] text-muted-foreground text-right">Powered by GIPHY</div>
                </div>
              )}

              {recording && (
                <div className="flex items-center gap-2 mb-2 px-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-destructive animate-pulse" />
                  <span className="text-sm text-destructive font-medium">Kayıt yapılıyor... {recordSecs}s</span>
                  <span className="text-xs text-muted-foreground">(maks 60s)</span>
                </div>
              )}

              <form onSubmit={sendTextMessage} className="flex items-end gap-1.5">
                <button type="button" data-testid="button-emoji" onClick={() => { setShowGif(false); setShowEmoji(v => !v); }}
                  className={`p-2 rounded-xl transition shrink-0 ${showEmoji ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>
                  </svg>
                </button>

                <button type="button" data-testid="button-gif" onClick={openGifPanel}
                  className={`px-2 py-1.5 rounded-xl text-xs font-bold transition shrink-0 leading-none ${showGif ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
                  title="GIF gönder">
                  GIF
                </button>

                <button type="button" data-testid="button-mic" onClick={recording ? stopRecording : startRecording}
                  className={`p-2 rounded-xl transition shrink-0 ${recording ? "bg-destructive text-destructive-foreground animate-pulse" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
                  title={recording ? "Kaydı durdur ve gönder" : "Sesli mesaj kaydet"}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
                  </svg>
                </button>

                <input ref={imgInputRef} type="file" accept="image/*" className="hidden" onChange={handleImgUpload} />
                <button type="button" data-testid="button-screenshot" onClick={() => imgInputRef.current?.click()} disabled={sendingImg}
                  className="p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition shrink-0 disabled:opacity-40"
                  title="Görsel gönder">
                  {sendingImg
                    ? <span className="border-2 border-muted border-t-primary rounded-full animate-spin block" style={{ width: 18, height: 18 }} />
                    : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
                      </svg>
                  }
                </button>

                <div className="flex-1 flex flex-col gap-0.5">
                  <textarea ref={textareaRef} data-testid="input-message" value={text}
                    onChange={handleTextChange}
                    onKeyDown={handleKeyDown}
                    placeholder={isMuted ? `Susturuldun — ${muteMinutes}:${String(muteSecs).padStart(2, "0")} kaldı` : "Mesaj yaz... (Enter gönderir)"}
                    rows={1}
                    disabled={isMuted}
                    style={{ resize: "none", minHeight: 40, maxHeight: 120 }}
                    className={`w-full px-3.5 py-2.5 text-sm rounded-xl border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition disabled:opacity-50 disabled:cursor-not-allowed ${isOverLimit ? "border-destructive" : "border-input"}`}
                    onInput={e => { const t = e.currentTarget; t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 120) + "px"; }}
                  />
                  {/* Char counter */}
                  {text.length > 0 && (
                    <div className={`text-right text-[10px] pr-1 ${charsLeft < 50 ? (charsLeft < 0 ? "text-destructive font-bold" : "text-orange-500") : "text-muted-foreground"}`}>
                      {charsLeft} karakter kaldı
                    </div>
                  )}
                </div>

                <button data-testid="button-send" type="submit" disabled={!text.trim() || sending || isMuted || isOverLimit}
                  className="p-2.5 rounded-xl bg-primary text-primary-foreground disabled:opacity-40 hover:opacity-90 active:opacity-80 transition shrink-0">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                  </svg>
                </button>
              </form>
            </div>
          </>
        )}
      </div>

      {/* Lightbox */}
      {lightboxImg && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 cursor-pointer" onClick={() => setLightboxImg(null)}>
          <img src={lightboxImg} alt="Tam ekran" className="max-w-full max-h-full rounded-xl shadow-2xl" onClick={e => e.stopPropagation()} />
          <button onClick={() => setLightboxImg(null)} className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      )}
    </div>
  );
}
