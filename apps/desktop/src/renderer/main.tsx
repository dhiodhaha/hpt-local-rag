import { createRoot } from "react-dom/client";
import { createClient } from "@hpt/server/client";
import { ChatScreen } from "./chat/ChatScreen.tsx";
import { ChatProvider } from "./chat/context.tsx";
import { createChatStore } from "./chat/store.ts";
import "./styles/app.css";

const client = createClient(window.hptPipe);
const store = createChatStore(client);

createRoot(document.getElementById("root") as HTMLElement).render(
  <ChatProvider client={client} store={store}>
    <ChatScreen />
  </ChatProvider>,
);
