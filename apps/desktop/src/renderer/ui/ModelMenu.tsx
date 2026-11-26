import type { ReactNode } from "react";

export type ModelMenuProps = {
  footer: string;
  groups: ReactNode;
};

export function ModelMenu({ footer, groups }: ModelMenuProps) {
  return (
    <div className="mm" role="menu">
      <div className="mm-ls">{groups}</div>
      <div className="mm-ft">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m16 3 4 4-4 4" />
          <path d="M20 7H4" />
          <path d="m8 21-4-4 4-4" />
          <path d="M4 17h16" />
        </svg>
        <span>{footer}</span>
      </div>
    </div>
  );
}
