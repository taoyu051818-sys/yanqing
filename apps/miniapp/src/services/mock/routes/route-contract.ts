export type MockRouteResult =
  { handled: false } | { handled: true; value: any };
export interface MockRouteOptions {
  persistLoginToken?: boolean;
  beforeHandle?: () => void;
}
