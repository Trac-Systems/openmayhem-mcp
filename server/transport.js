const RESPONSE_LIMIT = 40 * 1024 * 1024;
export class StdioBridge {
    options;
    pending = new Map();
    fetch;
    closed = false;
    constructor(options) {
        this.options = options;
        this.fetch = options.fetch ?? fetch;
    }
    async handleLine(line) {
        let message;
        try {
            message = JSON.parse(line);
        }
        catch {
            this.options.diagnose("stdin contained invalid JSON-RPC");
            return;
        }
        if (!isRecord(message)) {
            this.options.diagnose("stdin contained invalid JSON-RPC");
            return;
        }
        const id = message.id;
        if (message.method === "notifications/cancelled") {
            const requestId = isRecord(message.params) ? message.params.requestId : undefined;
            if (validId(requestId))
                this.pending.get(idKey(requestId))?.abort("cancelled");
            return;
        }
        if (this.closed)
            return this.replyError(id, -32000, "OpenMayhem MCP is shutting down");
        const controller = new AbortController();
        if (validId(id))
            this.pending.set(idKey(id), controller);
        try {
            const response = await this.fetch(this.options.endpoint, {
                method: "POST",
                headers: {
                    accept: "application/json, text/event-stream",
                    "content-type": "application/json",
                    "x-openmayhem-api-key": this.options.apiKey,
                    "user-agent": "@openmayhem/mcp/1.0.0",
                },
                body: JSON.stringify(message),
                signal: controller.signal,
            });
            if (!response.ok)
                throw new BridgeError(`remote returned HTTP ${response.status}`);
            const count = await this.forwardResponse(response);
            if (validId(id) && count === 0)
                throw new BridgeError("remote returned no JSON-RPC response");
        }
        catch (error) {
            if (controller.signal.aborted) {
                this.replyError(id, -32800, "Request cancelled");
            }
            else {
                const message = safeMessage(error, this.options.apiKey);
                this.options.diagnose(message);
                this.replyError(id, -32000, message);
            }
        }
        finally {
            if (validId(id))
                this.pending.delete(idKey(id));
        }
    }
    close() {
        this.closed = true;
        for (const controller of this.pending.values())
            controller.abort("shutdown");
    }
    async forwardResponse(response) {
        if (!response.body)
            return 0;
        const isEvents = (response.headers.get("content-type") ?? "").includes("text/event-stream");
        if (!isEvents) {
            const text = await boundedText(response.body);
            if (!text.trim())
                return 0;
            this.options.write(parseProtocol(text));
            return 1;
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const parser = new EventParser();
        let total = 0;
        let count = 0;
        try {
            for (;;) {
                const next = await reader.read();
                if (next.value) {
                    total += next.value.byteLength;
                    if (total > RESPONSE_LIMIT)
                        throw new BridgeError("remote response exceeded the size limit");
                }
                for (const data of parser.push(decoder.decode(next.value, { stream: !next.done }))) {
                    if (data === "[DONE]")
                        continue;
                    this.options.write(parseProtocol(data));
                    count += 1;
                }
                if (next.done)
                    break;
            }
            parser.finish();
            return count;
        }
        finally {
            reader.releaseLock();
        }
    }
    replyError(id, code, message) {
        if (!validId(id))
            return;
        this.options.write({ jsonrpc: "2.0", id, error: { code, message } });
    }
}
export function validatedEndpoint(value) {
    const endpoint = new URL(value ?? "https://mcp.openmayhem.ai/mcp");
    if (endpoint.protocol !== "https:" && !["localhost", "127.0.0.1", "::1"].includes(endpoint.hostname)) {
        throw new BridgeError("OPENMAYHEM_MCP_URL must use HTTPS outside localhost");
    }
    return endpoint;
}
export function safeMessage(error, secret) {
    const message = error instanceof Error ? error.message : "request failed";
    return (secret ? message.replaceAll(secret, "[redacted]") : message).slice(0, 300);
}
class EventParser {
    buffer = "";
    push(chunk) {
        this.buffer += chunk;
        const output = [];
        for (;;) {
            const match = /\r?\n\r?\n/.exec(this.buffer);
            if (!match || match.index === undefined)
                break;
            const block = this.buffer.slice(0, match.index);
            this.buffer = this.buffer.slice(match.index + match[0].length);
            const data = block.split(/\r?\n/)
                .filter((line) => line.startsWith("data:"))
                .map((line) => line.slice(5).replace(/^ /, ""))
                .join("\n");
            if (data)
                output.push(data);
        }
        if (this.buffer.length > RESPONSE_LIMIT)
            throw new BridgeError("remote event exceeded the size limit");
        return output;
    }
    finish() {
        if (this.buffer.split(/\r?\n/).some((line) => line.startsWith("data:"))) {
            throw new BridgeError("remote ended inside an event");
        }
        this.buffer = "";
    }
}
async function boundedText(stream) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let total = 0;
    let output = "";
    try {
        for (;;) {
            const next = await reader.read();
            if (next.done)
                break;
            total += next.value.byteLength;
            if (total > RESPONSE_LIMIT)
                throw new BridgeError("remote response exceeded the size limit");
            output += decoder.decode(next.value, { stream: true });
        }
        return output + decoder.decode();
    }
    finally {
        reader.releaseLock();
    }
}
function parseProtocol(value) {
    try {
        const parsed = JSON.parse(value);
        if (!isRecord(parsed) || parsed.jsonrpc !== "2.0")
            throw new Error();
        return parsed;
    }
    catch {
        throw new BridgeError("remote returned malformed JSON-RPC");
    }
}
function validId(value) {
    return typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
}
function idKey(value) {
    return `${typeof value}:${String(value)}`;
}
function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
class BridgeError extends Error {
}
