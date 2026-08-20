/**
 * Keep the MCP Node process alive after unexpected errors.
 *
 * Tool/request handlers already catch most failures and return JSON-RPC / tool
 * isError results. What still kills a default Node process is an *uncaught*
 * exception or an unhandled rejection outside those paths (SDK edge case,
 * bug in middleware, etc.). For a public /mcp endpoint we prefer "log and keep
 * serving" over exiting — downtime here breaks every agent that depends on us.
 *
 * Caveat (Node docs): after an uncaughtException the process *may* be in an
 * inconsistent state. We still stay up because the alternative is guaranteed
 * unavailability; the Docker entrypoint also restarts the process if it exits.
 */
export function installProcessGuards(log: (message: string, error: unknown) => void = defaultLog): void {
  process.on('uncaughtException', error => {
    log('uncaughtException (MCP process kept alive)', error);
  });

  process.on('unhandledRejection', reason => {
    log('unhandledRejection (MCP process kept alive)', reason);
  });
}

function defaultLog(message: string, error: unknown): void {
  console.error(`[secureflows-mcp] ${message}:`, error);
}
