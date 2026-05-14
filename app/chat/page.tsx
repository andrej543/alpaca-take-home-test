import type { Metadata } from "next";
import { ChatPanel } from "@/components/chat-panel";
import "./chat-page.css";

export const metadata: Metadata = {
  title: "Chat with the data · Alpaca take-home",
  description:
    "Ask questions grounded in the B2C analysis page and PM revenue dataset.",
};

type ChatPageProps = {
  searchParams: Promise<{ embed?: string | string[] }>;
};

export default async function ChatPage({ searchParams }: ChatPageProps) {
  const sp = await searchParams;
  const raw = sp.embed;
  const flag = Array.isArray(raw) ? raw[0] : raw;
  const embedded = flag === "1" || flag === "true";
  return <ChatPanel embedded={embedded} />;
}
