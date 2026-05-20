import express from "express";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import path from "path";
import { fileURLToPath } from "url";
import { PagingSimulator } from "../core/simulator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const TOTAL_FRAMES = parseInt(process.env.FRAMES ?? "8", 10);
const QUANTUM = parseInt(process.env.QUANTUM ?? "5", 10);
const CLOCK_CYCLE = parseInt(process.env.CLOCK ?? "3", 10);

// Serve static frontend
app.use(express.static(path.join(__dirname, "../../public")));
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "../../public/index.html"));
});
app.get("/client", (_req, res) => {
  res.sendFile(path.join(__dirname, "../../public/client.html"));
});

// ─── WebSocket ────────────────────────────────────────────────────────────────

const wss = new WebSocketServer({ server });
const simulator = new PagingSimulator(TOTAL_FRAMES, QUANTUM, CLOCK_CYCLE);

// Track which ws is a "node origin" client (vs GUI)
const originClients = new Map<string, WebSocket>(); // nodeId → ws
const guiClients = new Set<WebSocket>();

function broadcast(data: object, exclude?: WebSocket): void {
  const msg = JSON.stringify(data);
  for (const client of guiClients) {
    if (client !== exclude && client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

function sendToOrigin(nodeId: string, data: object): void {
  const ws = originClients.get(nodeId);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

wss.on("connection", (ws) => {
  let nodeId: string | null = null;
  let isOrigin = false;

  ws.on("message", (raw) => {
    let msg: any;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    switch (msg.type) {
      case "register_gui": {
        guiClients.add(ws);
        // Send current state
        ws.send(JSON.stringify({
          type: "state",
          data: simulator.getFullSnapshot(),
        }));
        break;
      }

      case "register_origin": {
        isOrigin = true;
        nodeId = msg.nodeId ?? `node-${Date.now()}`;
        originClients.set(nodeId!, ws);
        ws.send(JSON.stringify({ type: "registered", nodeId }));
        break;
      }

      case "add_process": {
        const { name, numPages, refs, originNodeId } = msg;
        if (!name || !numPages || !Array.isArray(refs)) {
          ws.send(JSON.stringify({ type: "error", message: "Invalid process data" }));
          return;
        }
        const pcb = simulator.addProcess(name, numPages, refs, originNodeId ?? nodeId ?? undefined);
        if (!pcb) {
          ws.send(JSON.stringify({ type: "error", message: "Invalid page references (out of range)" }));
          return;
        }
        const snapshot = simulator.getFullSnapshot();
        broadcast({ type: "state", data: snapshot });
        // Also send back to origin if applicable
        if (isOrigin && nodeId) {
          ws.send(JSON.stringify({ type: "process_added", pid: pcb.pid, name: pcb.name }));
        }
        break;
      }

      case "step": {
        const result = simulator.step();
        const snapshot = simulator.getFullSnapshot();
        broadcast({ type: "step_result", result, state: snapshot });

        // If a process finished, notify its origin node
        if (result.processFinished && result.finishedPid !== undefined) {
          const finished = simulator.getFinishedProcesses().find(p => p.pid === result.finishedPid);
          if (finished?.originNodeId) {
            sendToOrigin(finished.originNodeId, {
              type: "process_finished",
              pid: finished.pid,
              name: finished.name,
              arrivalTime: finished.arrivalTime,
              finishTime: finished.finishTime,
              waitTime: finished.waitTime,
              pageFaults: finished.pageFaults,
              refsExecuted: finished.refsExecuted,
            });
          }
        }
        break;
      }

      case "step_back": {
        const snap = simulator.stepBack();
        if (snap) {
          const snapshot = simulator.getFullSnapshot();
          broadcast({ type: "state", data: snapshot });
        }
        break;
      }

      case "get_state": {
        ws.send(JSON.stringify({ type: "state", data: simulator.getFullSnapshot() }));
        break;
      }
    }
  });

  ws.on("close", () => {
    guiClients.delete(ws);
    if (nodeId) originClients.delete(nodeId);
  });
});

server.listen(PORT, () => {
  console.log(`\n🖥️  MemSim Server running at http://localhost:${PORT}`);
  console.log(`📡  WebSocket ready on ws://localhost:${PORT}`);
  console.log(`📋  Config: frames=${TOTAL_FRAMES}, quantum=${QUANTUM}, clockCycle=${CLOCK_CYCLE}\n`);
});
