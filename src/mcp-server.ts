import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { DEFAULT_LIMITS } from "./runtime/session/Limits.js";
import { ToolExecutor } from "./runtime/executor/ToolExecutor.js";
import { InterruptManager } from "./runtime/interrupt/InterruptManager.js";
import { createAgentRuntime, runTurn, describeLlmProvider, type Confirm } from "./runtime/AgentRuntime.js";

const PORT = Number(process.env.AYMI_MCP_PORT ?? 8790);
const AUTH_TOKEN = process.env.AYMI_MCP_TOKEN;
const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "gemma4:e4b";

if (!AUTH_TOKEN) {
  console.error(
    "AYMI_MCP_TOKEN não definido - este servidor expõe controle real da máquina (abrir apps, escrever arquivos) " +
      "para qualquer coisa na mesma rede. Defina AYMI_MCP_TOKEN no .env antes de rodar."
  );
  process.exit(1);
}

/**
 * Yet another presentation consumer of the same AgentRuntime/runTurn() as
 * the CLI, the WS bridge, and VoiceRuntime - a phone/Claude client talking
 * MCP is architecturally no different from any of those. Deliberately does
 * NOT expose aymi's individual OS tools (open_application, write_file, ...)
 * directly as MCP tools - that would let a connected client call them
 * without ever going through the Policy Engine. The one tool here routes
 * everything through runTurn(), so every existing safety property (risk-
 * based confirmation, the deterministic Policy Engine, tracing) still
 * applies exactly as it does today.
 */
const runtime = createAgentRuntime({ ollamaHost: OLLAMA_HOST, ollamaModel: OLLAMA_MODEL });
const session = runtime.sessions.createSession();
const executor = new ToolExecutor(runtime.registry, runtime.events, session.id);

function buildConfirm(mcpServer: McpServer): Confirm {
  return async (message, signal) => {
    if (signal.aborted) return false;
    try {
      const result = await mcpServer.server.elicitInput({
        message,
        requestedSchema: {
          type: "object",
          properties: {
            approved: { type: "boolean", title: "Aprovar esta ação?" },
          },
          required: ["approved"],
        },
      });
      if (result.action !== "accept") return false;
      const content = result.content as { approved?: boolean } | undefined;
      return content?.approved === true;
    } catch {
      // A client that doesn't support elicitation, or a hard transport
      // failure, must not hang the turn forever - degrade to a safe deny
      // (R1 - nothing gets authority it wasn't explicitly given).
      return false;
    }
  };
}

function createServerInstance(): McpServer {
  const mcpServer = new McpServer({ name: "kira", version: "0.1.0" });

  mcpServer.registerTool(
    "ask_kira",
    {
      title: "Ask Kira",
      description:
        "Sends a message to Kira, the local desktop AI agent, and returns her response. " +
        "Kira can answer general questions and control this specific Windows machine " +
        "(open/close apps, open files/folders/URLs, read/search/write files, etc.) - " +
        "actions with real side effects will ask you to confirm before running.",
      inputSchema: { message: z.string().describe("What to say to Kira, in natural language (Portuguese or English).") },
    },
    async ({ message }) => {
      const interrupt = new InterruptManager();
      const confirm = buildConfirm(mcpServer);
      const result = await runTurn(runtime, session, executor, message, DEFAULT_LIMITS, interrupt, confirm, { quiet: true });
      return { content: [{ type: "text", text: result.finalMessage }] };
    }
  );

  return mcpServer;
}

// Session-id -> transport, matching the SDK's own reference pattern (see
// examples/server/simpleStreamableHttp.js) - a Streamable HTTP session
// spans multiple HTTP requests, so the *same* transport (and MCP server
// instance connected to it) must be reused across them, not recreated per
// request. One aymi session/runtime is shared across all MCP connections,
// same as server.ts/main.ts already do for WS/CLI.
const transports: Record<string, StreamableHTTPServerTransport> = {};

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : undefined);
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

async function handleMcpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const body = req.method === "POST" ? await readBody(req) : undefined;

  let transport = sessionId ? transports[sessionId] : undefined;

  if (!transport) {
    if (sessionId) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "Session not found" }, id: null }));
      return;
    }
    if (!isInitializeRequest(body)) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Bad Request: No valid session ID provided" }, id: null }));
      return;
    }

    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (newSessionId) => {
        transports[newSessionId] = transport!;
      },
    });
    transport.onclose = () => {
      const sid = transport!.sessionId;
      if (sid) delete transports[sid];
    };

    const mcpServer = createServerInstance();
    await mcpServer.connect(transport);
  }

  await transport.handleRequest(req, res, body);
}

const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${AUTH_TOKEN}`) {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "unauthorized" }));
    return;
  }

  try {
    await handleMcpRequest(req, res);
  } catch (err) {
    console.error("[mcp] erro tratando requisição:", err);
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null }));
    }
  }
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`aymi MCP server listening on http://0.0.0.0:${PORT}/ (reachable from other devices on the same network)`);
  console.log(`Modelo: ${describeLlmProvider(OLLAMA_MODEL, OLLAMA_HOST)}`);
  console.log(`Ferramentas do agente: ${runtime.registry.list().map((t) => t.name).join(", ")}`);
  console.log("Exposto pelo MCP: ask_kira (única ferramenta - tudo passa pelo mesmo runTurn()/Policy Engine)");
});

process.on("SIGINT", () => {
  runtime.sessions.closeSession(session);
  httpServer.close();
  process.exit(0);
});
