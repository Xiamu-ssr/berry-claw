/**
 * berry config get/set — read or modify berry-claw configuration.
 * Calls existing REST API endpoints.
 */
const DEFAULT_PORT = 3210;

function baseUrl(): string {
  const port = parseInt(process.env.PORT ?? String(DEFAULT_PORT), 10);
  return `http://localhost:${port}/api/config`;
}

export async function runConfig(args: string[]): Promise<void> {
  const [action, scope, ...rest] = args;

  if (!action || !scope) {
    console.log(`Usage: berry config <get|set> <provider|model|tier|agent> [key] [value]`);
    process.exitCode = 1;
    return;
  }

  if (action === 'get') {
    await getConfig(scope, rest[0]);
  } else if (action === 'set') {
    await setConfig(scope, rest);
  } else {
    console.error(`Unknown action "${action}". Use "get" or "set".`);
    process.exitCode = 1;
  }
}

async function getConfig(scope: string, key?: string): Promise<void> {
  try {
    let url: string;
    switch (scope) {
      case 'provider':
        url = key ? `${baseUrl()}/provider-instances/${key}` : `${baseUrl()}/provider-instances`;
        break;
      case 'model':
        url = key ? `${baseUrl()}/models/${key}` : `${baseUrl()}/models`;
        break;
      case 'tier':
        url = `${baseUrl()}/tiers`;
        break;
      case 'agent':
        // No dedicated agent list endpoint; use /api/agents
        const port = parseInt(process.env.PORT ?? String(DEFAULT_PORT), 10);
        url = key ? `http://localhost:${port}/api/agents/${key}` : `http://localhost:${port}/api/agents`;
        break;
      default:
        console.error(`Unknown scope "${scope}". Use provider, model, tier, or agent.`);
        process.exitCode = 1;
        return;
    }

    const res = await fetch(url);
    if (!res.ok) {
      console.error(`Error: ${res.status} ${res.statusText}`);
      process.exitCode = 1;
      return;
    }
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
      console.error(`Server not running.`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}

async function setConfig(scope: string, args: string[]): Promise<void> {
  const [key, ...valueParts] = args;

  if (!key) {
    console.error(`"set" requires a key. Usage: berry config set <scope> <key> <value>`);
    process.exitCode = 1;
    return;
  }

  try {
    let url: string;
    let method: string;
    let body: unknown;

    switch (scope) {
      case 'model': {
        url = `${baseUrl()}/models/${key}`;
        method = 'PUT';
        const valueStr = valueParts.join(' ');
        body = JSON.parse(valueStr);
        break;
      }
      case 'tier': {
        url = `${baseUrl()}/tiers/${key}`;
        method = 'PUT';
        const modelId = valueParts[0];
        body = JSON.stringify(modelId);
        // Tier endpoint expects plain JSON string, not object
        const port = parseInt(process.env.PORT ?? String(DEFAULT_PORT), 10);
        const tierRes = await fetch(`http://localhost:${port}/api/config/tiers/${key}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(modelId),
        });
        if (!tierRes.ok) {
          console.error(`Error: ${tierRes.status} ${tierRes.statusText}`);
          process.exitCode = 1;
          return;
        }
        const data = await tierRes.json();
        console.log(JSON.stringify(data, null, 2));
        return;
      }
      case 'provider':
      case 'agent':
      default:
        console.error(`"set ${scope}" is not yet supported via CLI. Use the web UI or edit config.json.`);
        process.exitCode = 1;
        return;
    }

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error(`Error: ${res.status} ${res.statusText}`);
      process.exitCode = 1;
      return;
    }
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
      console.error(`Server not running.`);
      process.exitCode = 1;
      return;
    }
    if (err instanceof SyntaxError) {
      console.error(`Invalid JSON value. Provide a valid JSON object, e.g.: berry config set model my-model '{"providers":[{"providerId":"xxx"}]}'`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}