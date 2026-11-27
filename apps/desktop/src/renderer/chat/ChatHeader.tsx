import { AnimatePresence, motion } from "motion/react";
import { MOTION } from "../motion.ts";
import { COPY } from "./copy.ts";
import { BUTTON_RADII, CLOSE_DELAY_S, CLOSE_SPRING, ICON, LABEL, SURFACE } from "./panelSpring.ts";
import { BOOK } from "./SumberIcon.tsx";

const TRAVEL = { layout: { ...CLOSE_SPRING, delay: CLOSE_DELAY_S } };

/** The count has no twin in the panel. It leaves at once while the icon and the word travel, and it returns only once the button is home, so the surface never stretches it on the way. */
const COUNT_EXIT = { opacity: 0, transition: { duration: MOTION.wordFadeMs / 1000 / 2, ease: MOTION.easing } };
const COUNT_RETURN = { initial: { opacity: 0 }, animate: { opacity: 1, transition: { delay: CLOSE_DELAY_S + CLOSE_SPRING.duration, duration: MOTION.wordFadeMs / 1000, ease: MOTION.easing } } };

export type ChatHeaderProps = {
  title: string;
  meta: string;
  /** How many sources the panel holds, or null when this answer has no panel. */
  sources: number | null;
  sourcesOpen: boolean;
  onSources: () => void;
};

/** The title over a soft blur, and the button that opens the Sumber panel. The panel starts closed. */
export function ChatHeader({ title, meta, sources, sourcesOpen, onSources }: ChatHeaderProps) {
  return (
    <header className="cv-head">
      <motion.div layout="position" style={{ minWidth: 0 }}>
        <div className="cv-title">{title}</div>
        <div className="cv-meta">{meta}</div>
      </motion.div>
      <AnimatePresence initial={false}>
        {sources === null || sourcesOpen ? null : (
          <motion.button key="sumber" layoutId={SURFACE} type="button" className="icon-btn cv-src" style={BUTTON_RADII} transition={TRAVEL} aria-label={COPY.sourcesButton(sources)} aria-expanded={false} onClick={onSources}>
            <motion.span layoutId={ICON} transition={TRAVEL} style={{ display: "inline-flex" }}>
              {BOOK}
            </motion.span>
            <motion.span layoutId={LABEL} transition={TRAVEL}>
              {COPY.sources}
            </motion.span>
            <motion.span {...COUNT_RETURN} exit={COUNT_EXIT} style={{ marginLeft: -4 }}>
              {sources}
            </motion.span>
          </motion.button>
        )}
      </AnimatePresence>
    </header>
  );
}
