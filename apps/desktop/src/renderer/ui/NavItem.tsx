import type { ReactNode } from "react";

export const NAV_ITEM_STATES = ["default", "active"] as const;
export type NavItemState = (typeof NAV_ITEM_STATES)[number];

export type NavItemProps = {
  state?: NavItemState;
  label: string;
  icon: ReactNode;
  onClick?: () => void;
};

export function NavItem({ state = "default", label, icon, onClick }: NavItemProps) {
  return (
    <button
      type="button"
      className="nav"
      data-state={state}
      aria-current={state === "active" ? "page" : undefined}
      onClick={onClick}
    >
      <span className="ic">{icon}</span>
      <span>{label}</span>
    </button>
  );
}
