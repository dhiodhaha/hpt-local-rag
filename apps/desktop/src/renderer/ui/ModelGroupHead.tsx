import type { ReactNode } from "react";
import { PROVIDER_LOGOS, type Provider } from "./providerLogos";

export const MODEL_GROUP_HEAD_TONES = ["ok", "limit", "off"] as const;
export type ModelGroupHeadTone = (typeof MODEL_GROUP_HEAD_TONES)[number];

export type ModelGroupHeadProps = {
  provider?: Provider;
  tone?: ModelGroupHeadTone;
  name: string;
  status: string;
  action?: ReactNode;
};

export function ModelGroupHead({ provider = "claude", tone = "ok", name, status, action }: ModelGroupHeadProps) {
  return (
    <div className="mg" data-tone={tone}>
      <img className="mg-lg" src={PROVIDER_LOGOS[provider]} alt="" />
      <span className="mg-n">{name}</span>
      <span className="mg-s">
        <span className="mg-dot" />
        <span>{status}</span>
      </span>
      <div className="mg-ac">{action}</div>
    </div>
  );
}
