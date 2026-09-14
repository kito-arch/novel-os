import type { Metadata } from "next";
import Dashboard from "@/ui/dashboard";

export const metadata: Metadata = {
  title: "Novel OS",
};

export default function Home() {
  return <Dashboard />;
}