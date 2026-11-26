import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { noteIdOf, type PassageId } from "@hpt/server/client";
import { COPY } from "../chat/copy.ts";
import type { Reader, Turn } from "../chat/store.ts";
import { SourcesBody } from "../chat/SourcesPanel.tsx";
import { panelOf } from "../chat/view.ts";
import { Badge, Button, ReaderHeader, StateNotice, TocRow, type TocRowState } from "../ui/index.ts";
import { AnswerPane } from "./AnswerPane.tsx";
import { Article } from "./Article.tsx";
import { CiteNumber } from "./CiteNumber.tsx";
import { annotationsOf, bagianIndexOf, citedIn, documentOf, type ReaderDocument } from "./model.ts";
import { useReaderScroll } from "./useReaderScroll.ts";

export type ReaderViewProps = {
  reader: Reader;
  turn: Turn;
  closing: boolean;
  onClose: () => void;
  /** Moves to a passage, in this note or another one. */
  onShow: (id: PassageId) => void;
  onRetry: () => void;
};

/** Below this window width the table of contents starts closed, so the text keeps a readable column. */
const TOC_OPEN_FROM_PX = 1280;

type Tab = "answer" | "sources";
const TABS: readonly Tab[] = ["answer", "sources"];

const UP = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="m18 15-6-6-6 6" />
  </svg>
);
const DOWN = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="m6 9 6 6 6-6" />
  </svg>
);

function stateOf(index: number, at: number, marks: number): TocRowState {
  if (index === at) return "current";
  return marks > 0 ? "cited" : "default";
}

type ContentsProps = { doc: ReaderDocument; current: PassageId; cited: ReadonlySet<PassageId>; onGo: (id: PassageId) => void };

function Contents({ doc, current, cited, onGo }: ContentsProps) {
  const at = bagianIndexOf(doc, current);
  return (
    <nav className="rd-toc" aria-label={COPY.reader.toc}>
      <div className="rd-toc-h">
        <span className="lbl">{COPY.reader.toc}</span>
        <span className="rd-count">{COPY.reader.tocCount(doc.bagian.length, cited.size)}</span>
      </div>
      <div className="rd-toc-list">
        {doc.bagian.map((entry, index) => {
          const marks = entry.passages.filter((passage) => cited.has(passage.id)).length;
          const state = stateOf(index, at, marks);
          const first = entry.passages[0];
          return (
            <TocRow
              key={entry.n}
              state={state}
              n={String(entry.n)}
              title={entry.title ?? COPY.reader.untitled}
              meta={COPY.reader.paragraphs(entry.passages.length)}
              marks={marks === 0 ? null : <CiteNumber c={String(marks)} active={state === "current"} />}
              onClick={first === undefined ? undefined : () => onGo(first.id)}
            />
          );
        })}
      </div>
      <div className="rd-legend">
        <span className="rd-legend-dot" />
        {COPY.reader.citedLabel}
      </div>
      {doc.revised ? (
        <div className="rd-legend">
          <span className="rd-legend-dot" data-tone="revised" />
          {COPY.reader.legendRevised}
        </div>
      ) : null}
    </nav>
  );
}

function Pager({ doc, current, onGo }: Omit<ContentsProps, "cited">) {
  const at = bagianIndexOf(doc, current);
  const label = COPY.reader.bagian(at + 1, doc.bagian.length);
  const go = (to: number) => {
    const first = doc.bagian[to]?.passages[0];
    if (first !== undefined) onGo(first.id);
  };
  return (
    <div className="rd-pos" role="group" aria-label={label}>
      <span aria-live="polite">{label}</span>
      <button type="button" className="rd-pos-b" aria-label={COPY.reader.previous} disabled={at <= 0} onClick={() => go(at - 1)}>
        {UP}
      </button>
      <button type="button" className="rd-pos-b" aria-label={COPY.reader.next} disabled={at >= doc.bagian.length - 1} onClick={() => go(at + 1)}>
        {DOWN}
      </button>
    </div>
  );
}

function Tabs({ tab, count, onTab }: { tab: Tab; count: number; onTab: (tab: Tab) => void }) {
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = TABS[(TABS.indexOf(tab) + 1) % TABS.length] ?? "answer";
    onTab(next);
    requestAnimationFrame(() => document.getElementById(`rd-tab-${next}`)?.focus());
  };
  const props = (name: Tab) => ({
    id: `rd-tab-${name}`,
    role: "tab",
    className: "rd-tab",
    type: "button",
    "aria-selected": tab === name,
    "aria-controls": "rd-tabpanel",
    tabIndex: tab === name ? 0 : -1,
    onClick: () => onTab(name),
    onKeyDown,
  }) as const;
  return (
    <div className="rd-tabs" role="tablist" aria-label={COPY.reader.tabs}>
      <button {...props("answer")}>{COPY.reader.tabAnswer}</button>
      <button {...props("sources")}>
        {COPY.reader.tabSources}
        <span className="rd-cnt">{count}</span>
      </button>
    </div>
  );
}

const LOADING_WIDTHS = [100, 96, 88, 100, 72];

function Loading() {
  return (
    <div className="rd-page" aria-busy="true" aria-label={COPY.reader.loading}>
      <div className="sk" style={{ width: "46%", height: 26, marginTop: 28 }} />
      {LOADING_WIDTHS.map((width, index) => (
        <div key={index} className="sk" style={{ width: `${width}%`, height: 13, marginTop: index === 0 ? 28 : 14 }} />
      ))}
    </div>
  );
}

export function ReaderView({ reader, turn, closing, onClose, onShow, onRetry }: ReaderViewProps) {
  const root = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<Tab>("answer");
  const [tocOpen, setTocOpen] = useState(() => window.innerWidth >= TOC_OPEN_FROM_PX);
  const passages = reader.load.state === "ready" ? reader.load.passages : null;
  const doc = useMemo(() => (passages === null ? null : documentOf(passages)), [passages]);
  const { scroller, place, current, jumpTo } = useReaderScroll(doc, reader.passage);
  const annotations = useMemo(() => annotationsOf(turn.run.answer), [turn.run.answer]);
  const cited = useMemo(() => (doc === null ? [] : citedIn(doc, annotations)), [doc, annotations]);
  const citedIds = useMemo(() => new Set(cited.map((entry) => entry.passage.id)), [cited]);
  const sources = panelOf(turn.run);
  const hasContents = doc !== null && doc.bagian.length > 1;
  const title = doc?.title ?? turn.run.sources.find((card) => card.passage.id === reader.passage)?.passage.title ?? "";

  const sourcesPane = sources === null ? null : <SourcesBody panel={sources} turnKey={turn.key} earlier={[]} active={reader.passage} onOpen={(_turn, id) => go(id)} />;

  useEffect(() => {
    root.current?.querySelector<HTMLElement>("[data-reader-back]")?.focus();
  }, []);

  const go = (id: PassageId) => {
    onShow(id);
    if (noteIdOf(id) === reader.noteId) jumpTo(id);
  };

  return (
    <div ref={root} className="rd" data-closing={closing} data-reader={reader.noteId} data-load={reader.load.state} role="region" aria-label={COPY.reader.region}>
      <div className="rd-main">
        <ReaderHeader
          title={title}
          meta={doc?.meta ?? ""}
          backLabel={COPY.reader.back}
          badges={
            doc === null ? null : (
              <>
                <Badge tone="kind" t={doc.kindLabel} />
                {doc.revised ? <Badge tone="direvisi" t="Direvisi" /> : <Badge tone="berlaku" t="Berlaku" />}
              </>
            )
          }
          toc={hasContents ? { open: tocOpen, label: COPY.reader.toc, onToggle: () => setTocOpen(!tocOpen) } : null}
          onBack={onClose}
        />
        <div className="rd-body">
          {doc !== null && hasContents && tocOpen ? <Contents doc={doc} current={current} cited={citedIds} onGo={go} /> : null}
          <div className="rd-article">
            {reader.load.state === "failed" ? (
              <div className="rd-page">
                <StateNotice title={COPY.reader.failedTitle} body={COPY.reader.failedBody} actions={<Button tone="soft" label={COPY.retry} onClick={onRetry} />} />
              </div>
            ) : null}
            {reader.load.state === "loading" ? <Loading /> : null}
            {doc === null ? null : (
              <div ref={scroller} className="rd-scroll" tabIndex={0} aria-label={doc.title}>
                <Article doc={doc} annotations={annotations} current={current} place={place} onOpenNewer={go} />
              </div>
            )}
            {hasContents ? <div className="rd-fade" aria-hidden="true" /> : null}
            {doc !== null && hasContents ? <Pager doc={doc} current={current} onGo={go} /> : null}
          </div>
        </div>
      </div>
      <aside className="rd-aside">
        <Tabs tab={tab} count={sources?.heading.count ?? 0} onTab={setTab} />
        <div id="rd-tabpanel" role="tabpanel" aria-labelledby={`rd-tab-${tab}`} className="rd-pane">
          {tab === "answer" ? <AnswerPane turn={turn} doc={doc} annotations={annotations} cited={cited} current={current} onGo={go} /> : sourcesPane}
        </div>
      </aside>
    </div>
  );
}
