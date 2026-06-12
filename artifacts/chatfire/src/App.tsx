import { useState, useEffect } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import AuthPage from "@/pages/AuthPage";
import ChatPage from "@/pages/ChatPage";
import BannedPage from "@/pages/BannedPage";
import AdminPage from "@/pages/AdminPage";
import VerifyEmailPage from "@/pages/VerifyEmailPage";

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
  // undefined=loading, null=no doc (unverified new user), object=doc exists
  const [userData, setUserData] = useState<UserData | null | undefined>(undefined);
  const [isAdmin, setIsAdmin] = useState(false);

  // Detect /#/admin
  useEffect(() => {
    const check = () => {
      const hash = window.location.hash;
      setIsAdmin(hash === "#/admin" || hash.startsWith("#/admin"));
    };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, []);

  // Apply saved theme
  useEffect(() => {
    const saved = localStorage.getItem("chatfire-theme");
    if (saved === "dark") document.documentElement.classList.add("dark");
    else if (saved === "light") document.documentElement.classList.remove("dark");
    else if (window.matchMedia("(prefers-color-scheme: dark)").matches) document.documentElement.classList.add("dark");
  }, []);

  // Auth listener
  useEffect(() => {
    return onAuthStateChanged(auth, u => {
      setUser(u);
      if (!u) setUserData(undefined);
    });
  }, []);

  // Watch Firestore user doc
  useEffect(() => {
    if (!user) return;
    setUserData(undefined);
    return onSnapshot(doc(db, "users", user.uid), snap => {
      setUserData(snap.exists() ? (snap.data() as UserData) : null);
    });
  }, [user?.uid]);

  // Admin panel
  if (isAdmin) return <AdminPage />;

  // Auth loading
  if (user === undefined) return <LoadingScreen />;

  // Not logged in
  if (!user) return <AuthPage />;

  // Firestore doc loading
  if (userData === undefined) return <LoadingScreen />;

  // No Firestore doc → new unverified user waiting for email code
  if (userData === null) return <VerifyEmailPage />;

  // Banned
  if (userData.banned) {
    return <BannedPage reason={userData.banReason} bannedAt={userData.bannedAt} />;
  }

  return <ChatPage />;
}
