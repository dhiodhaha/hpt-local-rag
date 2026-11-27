import { useRef, type CSSProperties } from "react";
import { SwapSlot, UnverifiedRefNotice } from "../ui/index.ts";
import { AnswerActions } from "./AnswerActions.tsx";
import { ArticleRow, MarginLayer, type ArticleContext } from "./ArticleRow.tsx";
import { citedIn, marginPlan, plainTextOf, type Article, type LeadBlock, type MarginNote } from "./article.ts";
import { COPY } from "./copy.ts";
import { DalilBlockView } from "./DalilBlockView.tsx";
import { NotesBlockView } from "./NotesBlockView.tsx";
import { ProseView } from "./ProseView.tsx";
import { useNoteTops, useWide } from "./useMargin.ts";
import { useReveal } from "./useReveal.ts";

export type AnswerArticleProps = {
  article: Article;
  context: ArticleContext;
  revealOnArrival?: boolean;
  /** The summary has fully arrived and passed its checks: the rest of it catches up. */
  settled?: boolean;
};

const SKELETON_LEAD = (
  <div style={{ paddingTop: 6 }}>
    <div className="sk" style={{ width: "88%", height: 18 }} />
    <div className="sk" style={{ width: "54%", height: 18, marginTop: 10 }} />
  </div>
);

const SKELETON_MORE = (
  <div className="an-more-sk" aria-hidden="true">
    <div className="sk" style={{ width: "94%", height: 14 }} />
    <div className="sk" style={{ width: "62%", height: 14, marginTop: 9 }} />
  </div>
);

const NO_NOTES: readonly MarginNote[] = [];

type LeadProps = { lead: LeadBlock; prose: LeadBlock["summary"]; margin: readonly MarginNote[]; caret: boolean; animated: boolean; context: ArticleContext };

/** The headline in bold, then the note on what was inferred when there is one, then the summary, in one paragraph. */
function Lead({ lead, prose, margin, caret, animated, context }: LeadProps) {
  const { headline, inference } = lead;
  const marks = { numberOf: context.numberOf, active: context.active, onCite: context.onCite };
  return (
    <ArticleRow margin={margin} context={context}>
      <p className="an-p m-headline" data-lead="answer" data-basis={headline?.inferred === true ? "inferred" : "explicit"}>
        {headline === null ? null : (
          <b className="an-hl" data-verifying={headline.verifying}>
            {headline.text}
          </b>
        )}
        {headline !== null && (inference !== null || prose !== null) ? " " : null}
        {inference === null ? null : (
          <span data-infer="note">
            <ProseView spans={inference} {...marks} words={animated} />
          </span>
        )}
        {inference !== null && prose !== null ? " " : null}
        {prose === null ? null : <ProseView spans={prose} {...marks} words={animated} caret={caret} />}
      </p>
    </ArticleRow>
  );
}

function Footer({ article }: { article: Article }) {
  return (
    <div className="an-row m-field" style={{ "--i": 3 } as CSSProperties}>
      <div className="an-main">
        <p className="an-p an-closing">{COPY.article.closing}</p>
        <div className="an-foot">
          <AnswerActions text={plainTextOf(article)} />
        </div>
      </div>
    </div>
  );
}

export function AnswerArticle({ article, context, revealOnArrival = false, settled = true }: AnswerArticleProps) {
  const ref = useRef<HTMLElement>(null);
  const wide = useWide(ref);
  const hasReference = article.unverified.length > 0;
  const { lead } = article;
  const { prose, complete, animated } = useReveal(lead.summary, revealOnArrival, settled);
  const showSkeleton = lead.headline === null && !hasReference;
  const done = article.finished && complete;
  const plan = marginPlan(article, new Set([...citedIn(lead.inference), ...citedIn(prose)]));
  const tops = useNoteTops(ref, plan.all.map((note) => note.id), wide);
  const beside = (notes: readonly MarginNote[]) => (wide ? NO_NOTES : notes);
  return (
    <article ref={ref} className="an" data-card="answer" data-wide={wide}>
      {article.unverified.map((reference) => (
        <div key={reference.asStated} className="an-ref">
          <UnverifiedRefNotice rl={COPY.unverifiedLabel} rq={`“${reference.asStated}”`} nt={reference.note} />
        </div>
      ))}
      {hasReference && lead.headline === null ? null : (
        <SwapSlot fade={false} loading={showSkeleton} skeleton={SKELETON_LEAD}>
          <Lead lead={lead} prose={prose} margin={beside(plan.lead)} caret={lead.streaming || !complete} animated={animated} context={context} />
        </SwapSlot>
      )}
      <DalilBlockView blocks={article.dalil} margins={wide ? [] : plan.dalil} context={context} index={1} />
      {article.notes === null ? null : <NotesBlockView block={article.notes} margin={beside(plan.notes)} context={context} index={2} />}
      {article.pending ? SKELETON_MORE : null}
      {done ? <Footer article={article} /> : null}
      {wide && plan.all.length > 0 ? <MarginLayer notes={plan.all} context={context} tops={tops} /> : null}
    </article>
  );
}
