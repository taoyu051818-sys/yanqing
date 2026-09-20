import { commandHash } from "./command-hash";
export const mockExecutionKey = (phase: string, identity: unknown) =>
  `DIRECT:${commandHash({ phase, identity })}`;
