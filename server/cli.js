#!/usr/bin/env node
import { createInterface } from "node:readline";
import { StdioBridge, safeMessage, validatedEndpoint } from "./transport.js";
const apiKey = process.env.OPENMAYHEM_API_KEY?.trim();
if (!apiKey)
    fail("OPENMAYHEM_API_KEY is required");
let endpoint;
try {
    endpoint = validatedEndpoint(process.env.OPENMAYHEM_MCP_URL);
}
catch (error) {
    fail(safeMessage(error));
}
const bridge = new StdioBridge({
    apiKey,
    endpoint,
    write: (value) => process.stdout.write(`${JSON.stringify(value)}\n`),
    diagnose: (message) => process.stderr.write(`OpenMayhem MCP transport error: ${message}\n`),
});
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
const running = new Set();
lines.on("line", (line) => {
    if (!line.trim())
        return;
    const operation = bridge.handleLine(line).finally(() => running.delete(operation));
    running.add(operation);
});
lines.on("close", () => { void stop(); });
let stopping = false;
async function stop() {
    if (stopping)
        return;
    stopping = true;
    lines.close();
    bridge.close();
    await Promise.allSettled(running);
}
process.once("SIGTERM", () => { void stop(); });
process.once("SIGINT", () => { void stop(); });
function fail(message) {
    process.stderr.write(`OpenMayhem MCP: ${message}\n`);
    process.exit(1);
}
