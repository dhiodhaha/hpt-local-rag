import type { MouseEvent, ReactNode } from "react";
import { motion } from "motion/react";
import type { PassageId } from "@hpt/server/client";
import { FadeEdge } from "../ui/index.ts";
import { ChatHeader } from "./ChatHeader.tsx";
import { COPY } from "./copy.ts";
import type { Turn } from "./store.ts";
import { TurnView } from "./TurnView.tsx";
import { useFollow } from "./useFollow.ts";

export type ConversationProps = {
  turns: readonly Turn[];
  conversation: string | null;
  title: string;
  meta: string;
  active: PassageId | null;
  sources: number | null;
  sourcesOpen: boolean;
  /** Shown under the question box once the conversation holds a real answer. */
  disclaimer: boolean;
  notice: ReactNode;
  bar: ReactNode;
  onSources: () => void;
  onCite: (turnKey: string, id: PassageId) => void;
  onOpen: (turnKey: string, id: PassageId) => void;
  onPick: (option: string, event: MouseEvent<HTMLButtonElement>) => void;
  onRetry: (event: MouseEvent<HTMLButtonElement>) => void;
  onCancel: () => void;
};

/**
 * The conversation (D9.6): turns scroll under a soft blur at the top and at the bottom, with no scrollbar. The question box floats
 * above the bottom edge, and the caution sits under it once there is a real answer to caution about.
 */
export function Conversation({ turns, conversation, title, meta, active, sources, sourcesOpen, disclaimer, notice, bar, onSources, onCite, onOpen, onPick, onRetry, onCancel }: ConversationProps) {
  const { scroller, column } = useFollow(turns.length, conversation);
  return (
    <>
      <motion.div ref={scroller} layoutScroll className="cv-scroll">
        <motion.div ref={column} layout="position" className="cv-col">
          {turns.map((turn) => (
            <TurnView key={turn.key} turn={turn} active={active} onCite={(id) => onCite(turn.key, id)} onOpen={(id) => onOpen(turn.key, id)} onPick={onPick} onRetry={onRetry} onCancel={onCancel} />
          ))}
          <div className="cv-text" style={{ marginTop: 16 }}>
            {notice}
          </div>
        </motion.div>
      </motion.div>
      <FadeEdge side="top" height={104} />
      <ChatHeader title={title} meta={meta} sources={sources} sourcesOpen={sourcesOpen} onSources={onSources} />
      <FadeEdge side="bottom" height={150} />
      <motion.div layout="position" className="cv-box cv-float">
        {bar}
      </motion.div>
      <p className="cv-disc" data-show={disclaimer} aria-hidden={!disclaimer}>
        {COPY.disclaimer}
      </p>
    </>
  );
}
