import { Badge } from "../ui/index.ts";
import { ArticleRow, CitedText, type ArticleContext } from "./ArticleRow.tsx";
import type { MarginNote, NotesBlock } from "./article.ts";
import { COPY } from "./copy.ts";

/** The notes and exceptions as sentences: the first in the paragraph that opens with the lead, the rest each in a paragraph of their own. */
export function NotesBlockView({ block, margin, context, index }: { block: NotesBlock; margin: readonly MarginNote[]; context: ArticleContext; index: number }) {
  return (
    <ArticleRow margin={margin} context={context} index={index}>
      {block.items.map((item, at) => (
        <p key={item.id} className="an-p" data-note={item.id}>
          {at === 0 ? <b>{COPY.article.notesLead} </b> : null}
          {item.withheld ? <span className="an-warn">{item.text}</span> : <CitedText text={item.text} ids={item.cites} context={context} />}
          {item.inferred ? (
            <>
              {" "}
              <Badge />
            </>
          ) : null}
        </p>
      ))}
    </ArticleRow>
  );
}
