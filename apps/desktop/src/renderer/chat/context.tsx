import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import { useStore } from "zustand";
import type { ConnectionState, HptClient } from "@hpt/server/client";
import type { ChatActions, ChatState, ChatStore } from "./store.ts";

type Services = { readonly client: HptClient; readonly store: ChatStore };

const Context = createContext<Services | null>(null);

export function ChatProvider({ client, store, children }: Services & { children: ReactNode }) {
  return <Context.Provider value={{ client, store }}>{children}</Context.Provider>;
}

function services(): Services {
  const value = useContext(Context);
  if (value === null) throw new Error("ChatProvider is missing");
  return value;
}

export function useChat<T>(selector: (state: ChatState & ChatActions) => T): T {
  return useStore(services().store, selector);
}

export function useHost(): ConnectionState {
  const { client } = services();
  return useSyncExternalStore(client.subscribe, client.state);
}
