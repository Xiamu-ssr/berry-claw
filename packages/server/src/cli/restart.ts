/**
 * berry restart — request server runtime reload via API.
 * A real process exit only happens when the server was launched with
 * BERRY_CLAW_ALLOW_SELF_EXIT=1 under an external supervisor.
 */
const DEFAULT_PORT = 3210;

export async function runRestart(args?: string[]): Promise<void> {
  const port = parseInt(process.env.PORT ?? String(DEFAULT_PORT), 10);
  const url = `http://localhost:${port}/api/system/restart`;
  const reason = args?.length ? args.join(' ') : undefined;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    if (!res.ok) {
      console.error(`Error: ${res.status} ${res.statusText}`);
      process.exitCode = 1;
      return;
    }
    const data = await res.json() as { message?: string; mode?: string };
    console.log(data.message ?? 'Restart scheduled.');
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
      console.error(`Server not running on port ${port}.`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}
