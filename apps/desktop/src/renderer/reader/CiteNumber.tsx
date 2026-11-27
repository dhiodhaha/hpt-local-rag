/** The number of a citation drawn as a mark but not as a button: the rows and labels it sits in are the buttons. */
export function CiteNumber({ c, active = false }: { c: string; active?: boolean }) {
  return (
    <span className="c" data-state={active ? "active" : "default"}>
      {c}
    </span>
  );
}
