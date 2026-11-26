import { PROVIDER_LOGOS, type Provider } from "./providerLogos";

export type ModelTagProps = {
  provider?: Provider;
  label: string;
};

export function ModelTag({ provider = "codex", label }: ModelTagProps) {
  return (
    <span className="mt">
      <img className="mt-lg" src={PROVIDER_LOGOS[provider]} alt="" />
      <span>{label}</span>
    </span>
  );
}
