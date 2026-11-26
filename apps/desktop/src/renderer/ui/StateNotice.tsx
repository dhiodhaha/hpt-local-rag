import type { ReactNode } from "react";

export const STATE_NOTICE_KINDS = ["koneksi", "batas"] as const;
export type StateNoticeKind = (typeof STATE_NOTICE_KINDS)[number];

export type StateNoticeProps = {
  kind?: StateNoticeKind;
  title: string;
  body: string;
  extra?: ReactNode;
  actions?: ReactNode;
};

const ICON_PROPS = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

export function StateNotice({ kind = "koneksi", title, body, extra, actions }: StateNoticeProps) {
  return (
    <section className="sn">
      <span className="sn-ic">
        {kind === "koneksi" ? (
          <svg {...ICON_PROPS}>
            <path d="m19 5 3-3M2 22l3-3" />
            <path d="M6.3 20.3a2.4 2.4 0 0 0 3.4 0L12 18l-6-6-2.3 2.3a2.4 2.4 0 0 0 0 3.4Z" />
            <path d="M7.5 13.5 10 11M10.5 16.5 13 14" />
            <path d="m12 6 6 6 2.3-2.3a2.4 2.4 0 0 0 0-3.4l-2.6-2.6a2.4 2.4 0 0 0-3.4 0Z" />
          </svg>
        ) : (
          <svg {...ICON_PROPS}>
            <path d="M5 22h14M5 2h14" />
            <path d="M17 22v-4.17a2 2 0 0 0-.59-1.42L12 12l-4.41 4.41A2 2 0 0 0 7 17.83V22" />
            <path d="M7 2v4.17a2 2 0 0 0 .59 1.42L12 12l4.41-4.41A2 2 0 0 0 17 6.17V2" />
          </svg>
        )}
      </span>
      <div className="sn-bd">
        <p className="sn-t">{title}</p>
        <p className="sn-d">{body}</p>
        <div className="sn-x">{extra}</div>
        <div className="sn-ac">{actions}</div>
      </div>
    </section>
  );
}
