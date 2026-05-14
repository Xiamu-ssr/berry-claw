/**
 * berry status — print server health summary.
 * Calls GET /api/system/status on the configured port.
 */
const DEFAULT_PORT = 3210;

export async function runStatus(): Promise<void> {
  const port = parseInt(process.env.PORT ?? String(DEFAULT_PORT), 10);
  const url = `http://localhost:${port}/api/system/status`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`Error: ${res.status} ${res.statusText}`);
      process.exitCode = 1;
      return;
    }
    const data = await res.json() as Record<string, unknown>;

    const uptime = data.uptimeSeconds as number;
    const h = Math.floor(uptime / 3600);
    const m = Math.floor((uptime % 3600) / 60);
    const s = uptime % 60;
    const uptimeStr = h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`;

    console.log(`Berry-Claw server at http://localhost:${data.port}`);
    console.log(`  Uptime:       ${uptimeStr}`);
    console.log(`  Active agent: ${data.activeAgent}`);
    const model = data.currentModel as Record<string, string> | null;
    console.log(`  Model:        ${model ? model.model : '(none)'}`);
    console.log(`  Configured:   ${data.configured ? 'Yes' : 'No'}`);

    const agents = data.agents as Array<{ id: string; name: string; model: string; status: string }>;
    if (agents && agents.length > 0) {
      console.log('\n  Agents:');
      for (const a of agents) {
        const marker = a.id === data.activeAgent ? ' *' : '  ';
        console.log(`  ${marker} ${a.id}  ${a.name}  ${a.model}  [${a.status}]`);
      }
    }

    const tiers = data.tiers as Record<string, string> | null;
    if (tiers && Object.keys(tiers).length > 0) {
      console.log('\n  Tiers:');
      for (const [tier, modelId] of Object.entries(tiers)) {
        console.log(`    ${tier}: ${modelId}`);
      }
    }
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
      console.error(`Server not running on port ${port}.`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}