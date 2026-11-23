import type { Env } from '../types';
import { runTool, TOOL_DEFS } from './tools';

/**
 * "Ask Horn & Fin" for ChatGPT, Claude and other apps: a remote MCP server (Streamable HTTP, JSON responses).
 * Read-only lookups, no sign-in, no Claude API cost (the visitor's own app does the thinking).
 */

const PROTOCOL = '2025-06-18';
const INSTRUCTIONS =
  'Horn & Fin (hornandfin.com) hunting and fishing data: last-draw odds, confirmed application deadlines, rulebook passages with page cites, ' +
  'trout stockings and a directory of outfitters, guides and charters. Cite sources. Draw odds are last year\'s results, not guarantees. ' +
  'Rules answers are not legal advice. Label Featured listings as Featured.';

interface RpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

function reply(id: RpcRequest['id'], result: unknown) {
  return { jsonrpc: '2.0', id: id ?? null, result };
}
function fail(id: RpcRequest['id'], code: number, message: string) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

export async function handleRpc(env: Env, msg: RpcRequest): Promise<unknown | null> {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return fail(null, -32600, 'Invalid request');
  if (msg.id === undefined) return null; // notification: nothing to send back
  switch (msg.method) {
    case 'initialize':
      return reply(msg.id, {
        protocolVersion: PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'horn-and-fin', title: 'Horn & Fin', version: '1.0.0' },
        instructions: INSTRUCTIONS,
      });
    case 'ping':
      return reply(msg.id, {});
    case 'tools/list':
      return reply(msg.id, {
        tools: TOOL_DEFS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.input_schema, annotations: { readOnlyHint: true, openWorldHint: false } })),
      });
    case 'tools/call': {
      const name = String(msg.params?.name ?? '');
      if (!TOOL_DEFS.some((t) => t.name === name)) return fail(msg.id, -32602, `Unknown tool ${name}`);
      try {
        const out = await runTool(env, name, (msg.params?.arguments as Record<string, unknown>) ?? {});
        const isError = !!(out && typeof out === 'object' && 'error' in out);
        return reply(msg.id, { content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: out, isError });
      } catch (err) {
        return reply(msg.id, { content: [{ type: 'text', text: `Lookup failed: ${String(err instanceof Error ? err.message : err)}` }], isError: true });
      }
    }
    default:
      return fail(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

export async function mcpEndpoint(env: Env, req: Request): Promise<Response> {
  const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, mcp-session-id, mcp-protocol-version', 'access-control-allow-methods': 'POST, OPTIONS' };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method === 'GET') return new Response('Method not allowed', { status: 405, headers: { ...headers, allow: 'POST' } });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers });
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return Response.json(fail(null, -32700, 'Parse error'), { status: 400, headers });
  }
  const batch = Array.isArray(payload) ? payload.slice(0, 20) : [payload];
  const out = (await Promise.all(batch.map((m) => handleRpc(env, m as RpcRequest)))).filter((x) => x !== null);
  if (!out.length) return new Response(null, { status: 202, headers });
  return Response.json(Array.isArray(payload) ? out : out[0], { headers });
}
