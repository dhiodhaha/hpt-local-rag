export const NEW_CHAT_BUTTON_SIZES = ["drawer", "sidebar"] as const;
export type NewChatButtonSize = (typeof NEW_CHAT_BUTTON_SIZES)[number];

export type NewChatButtonProps = {
  size?: NewChatButtonSize;
  label: string;
  kbd?: string;
  onClick?: () => void;
};

export function NewChatButton({ size = "drawer", label, kbd, onClick }: NewChatButtonProps) {
  return (
    <button type="button" className="nc" data-size={size} onClick={onClick}>
      <svg
        width="19"
        height="19"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
      <span>{label}</span>
      <span className="kbd">{kbd}</span>
    </button>
  );
}
