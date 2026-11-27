import { Badge } from "../ui/index.ts";
import { ArticleRow, CiteRun, CitedText, type ArticleContext } from "./ArticleRow.tsx";
import type { DalilBlock, MarginNote } from "./article.ts";
import { COPY } from "./copy.ts";

function DalilRow({ block, margin, lead, context, index }: { block: DalilBlock; margin: readonly MarginNote[]; lead: boolean; context: ArticleContext; index?: number }) {
  return (
    <ArticleRow margin={margin} context={context} index={index}>
      <p className="an-p" data-dalil={block.id}>
        {lead ? <b>{COPY.article.dalilLead} </b> : null}
        {block.intro}
        <CiteRun ids={block.introCites} context={context} />
        {block.end}
      </p>
      {block.arabic === null ? null : (
        <p className="an-ar" dir="rtl" lang="ar">
          {block.arabic}
        </p>
      )}
      {block.meaning === null ? null : (
        <p className="an-tr">
          {block.meaning.label}: {block.meaning.text}
        </p>
      )}
      <p className="an-p an-exp">
        <CitedText text={block.explanation} ids={block.cites} context={context} />
        {block.inferred ? (
          <>
            {" "}
            <Badge />
          </>
        ) : null}
      </p>
    </ArticleRow>
  );
}

export type DalilBlockViewProps = {
  blocks: readonly DalilBlock[];
  /** The margin notes each dalil gets, one list for each block. */
  margins: readonly (readonly MarginNote[])[];
  context: ArticleContext;
  index: number;
};

/** Every dalil is written into the answer. "Dalilnya." introduces the first, and the rest follow as sentences of their own, each with its own margin note. */
export function DalilBlockView({ blocks, margins, context, index }: DalilBlockViewProps) {
  return (
    <>
      {blocks.map((block, at) => (
        <DalilRow key={block.id} block={block} margin={margins[at] ?? []} lead={at === 0} context={context} index={at === 0 ? index : 0} />
      ))}
    </>
  );
}
