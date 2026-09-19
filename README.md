# OpenMayhem MCP

OpenMayhem's local stdio bridge forwards MCP messages to the hosted OpenMayhem service. It contains no model catalog, pricing table, account balance, payment implementation, provider data, or credentials.

## Install

Download `openmayhem-mcp-v1.0.0.mcpb` from the [v1.0.0 release](https://github.com/Trac-Systems/openmayhem-mcp/releases/tag/v1.0.0) and install it in an MCPB-compatible client. The client asks for a restricted OpenMayhem API key and stores it as a sensitive setting.

Clients that support remote Streamable HTTP can connect directly:

```text
URL: https://mcp.openmayhem.ai/mcp
Header: X-OpenMayhem-API-Key: your restricted OpenMayhem API key
```

Create and revoke API keys at [openmayhem.ai](https://openmayhem.ai). Complete setup, tool, payment, and client instructions are at [openmayhem.ai/docs/mcp](https://openmayhem.ai/docs/mcp).

## Billing

Model discovery, request estimation, token counting, balance checks, job reads, cancellation, and owned-artifact lookup do not spend model credit. Model execution is paid. Every paid tool requires a current estimate and an explicit maximum cost.

The bridge does not calculate charges or handle payment information. Requests use the existing OpenMayhem account, balance, reservation, receipt, and settlement paths.

## Requirements

- Node.js 22 or newer
- A restricted OpenMayhem API key
- HTTPS access to `mcp.openmayhem.ai`

## License

MIT
