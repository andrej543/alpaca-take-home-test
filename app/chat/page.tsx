import type { Metadata } from "next";
import { ChatPanel } from "@/components/chat-panel";
import "./chat-page.css";

export const metadata: Metadata = {
  title: "Chat with the data · Alpaca take-home",
  description:
    "Ask questions grounded in the B2C analysis page and PM revenue dataset.",
};

export default function ChatPage() {
  return <ChatPanel />;
}
