import { useState, useEffect } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import AuthPage from "@/pages/AuthPage";
import ChatPage from "@/pages/ChatPage";
import BannedPage from "@/pages/BannedPage";
import AdminPage from "@/pages/AdminPage";

interface UserData {
  uid?: string;
  banned?: boolean;
  banReason?: string;
  bannedAt?: number;
  emailVerified?: boolean;
}

function LoadingScreen() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-3">
      <div className="w-12 h-12 rounded-2xl bg-primary flex items-center justify-center shadow-lg">
        <span className="text-2xl">🔥</span>
      </div>
      <div className="w-6 h-6 border-2 border-muted border-t-primary rounded-full animate-spin" />
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [userData, setUserData] = useState<UserData | null | undefined>(undefined);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const check = () => {
      const hash = window.location.hash;
      setIsAdmin(hash === "#/admin" || hash.startsWith("#/admin"));
    };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem("chatfire-theme");
    if (saved === "dark") document.documentElement.classList.add("dark");
    else if (saved === "light") document.documentElement.classList.remove("dark");
    else if (window.matchMedia("(prefers-color-scheme: dark)").matches) document.documentElement.classList.add("dark");
  }, []);

  useEffect(() => {
    return onAuthStateChanged(auth, u => {
      setUser(u);
      if (!u) setUserData(undefined);
    });
  }, []);

  useEffect(() => {
    if (!user) return;
    setUserData(undefined);
    return onSnapshot(doc(db, "users", user.uid), async snap => {
      if (snap.exists()) {
        setUserData(snap.data() as UserData);
      } else {
        // No Firestore doc — auto-create without email verification
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
            emailVerified: false,
          });
          localStorage.removeItem("cf_pending_reg");
        } else {
          // Fallback: create basic doc from Firebase auth info
          await setDoc(doc(db, "users", user.uid), {
            uid: user.uid,
            username: user.email?.split("@")[0] ?? user.uid.slice(0, 8),
            displayUsername: user.displayName ?? user.email?.split("@")[0] ?? "Kullanıcı",
            email: user.email ?? "",
            photoURL: user.photoURL ?? "",
            createdAt: Date.now(),
            emailVerified: false,
          });
        }
        setUserData(null);
      }
    });
  }, [user?.uid]);

  if (isAdmin) return <AdminPage />;
  if (user === undefined) return <LoadingScreen />;
  if (!user) return <AuthPage />;
  if (userData === undefined) return <LoadingScreen />;
  if (userData === null) return <LoadingScreen />;
  if (userData.banned) return <BannedPage reason={userData.banReason} bannedAt={userData.bannedAt} />;

  return <ChatPage />;
}
