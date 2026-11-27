export const BUTTON_TONES = ["solid", "soft", "ghost", "danger"] as const;
export const BUTTON_SIZES = ["md", "lg"] as const;
export type ButtonTone = (typeof BUTTON_TONES)[number];
export type ButtonSize = (typeof BUTTON_SIZES)[number];

import type { MouseEvent } from "react";

export type ButtonProps = {
  tone?: ButtonTone;
  size?: ButtonSize;
  label: string;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
};

export function Button({ tone = "solid", size = "md", label, onClick, disabled }: ButtonProps) {
  return (
    <button type="button" className="btn" data-tone={tone} data-size={size} onClick={onClick} disabled={disabled}>
      <span>{label}</span>
    </button>
  );
}
