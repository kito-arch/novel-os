import type { Metadata } from "next";
import AuthScreen from "@/ui/auth-screen";

export const metadata: Metadata = { title: "Sign in — Novel OS" };

export default function AuthPage() {
  return <AuthScreen />;
}
