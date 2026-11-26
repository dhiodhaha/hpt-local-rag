export const CONNECTION_STATUS_STATES = ["connected", "offline", "limit"] as const;
export type ConnectionStatusState = (typeof CONNECTION_STATUS_STATES)[number];

export type ConnectionStatusProps = {
  state?: ConnectionStatusState;
  logo: string;
  provider: string;
  status: string;
};

export function ConnectionStatus({ state = "connected", logo, provider, status }: ConnectionStatusProps) {
  return (
    <div className="cs" data-state={state}>
      <span className="cs-lg">
        <img className="cs-img" src={logo} alt="" />
      </span>
      <div className="cs-bd">
        <div className="cs-n">{provider}</div>
        <div className="cs-s">
          <span className="cs-dot" />
          <span className="cs-t">{status}</span>
        </div>
      </div>
    </div>
  );
}
