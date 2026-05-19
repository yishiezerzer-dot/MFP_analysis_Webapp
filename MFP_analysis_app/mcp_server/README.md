# MFP MCP Server

Local MCP bridge for the MFP Analysis app. It exposes the backend automation
action catalog as MCP tools so Claude Code, Cursor, Codex, or any other MCP
client can drive LCMS analysis through the same backend API.

This server does **not** expose filesystem, shell, or general network tools.
It only forwards calls to the local MFP backend automation endpoints.

## Install

Start the MFP backend first (it lives at `http://127.0.0.1:8000` by default).
Then install this package — preferably into a dedicated virtual environment so
the `mfp-mcp` console script lands on a predictable PATH:

```powershell
cd MFP_analysis_app\mcp_server
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e .
```

After install, both of these work:

```powershell
mfp-mcp           # console script (recommended)
python -m mfp_mcp # module form (works without the script on PATH)
```

Optional environment variables:

| Var | Default | Meaning |
|---|---|---|
| `MFP_BACKEND_URL` | `http://127.0.0.1:8000` | Backend automation API root |
| `MFP_MCP_TIMEOUT` | `60` | Per-request timeout in seconds |

## Client setup

The MCP config shape is **identical for all three clients** — only the
destination file differs. Copy `examples/mfp.mcp.json`, replace
`<ABSOLUTE_PATH_TO_REPO>` with the absolute path to the cloned repository, and
drop it into the path your client expects.

| Client | Config file path |
|---|---|
| **Claude Code** | run `claude mcp add mfp -- mfp-mcp` from the `mcp_server` directory (writes `~/.claude.json` for you) |
| **Cursor** | `<repo>/.cursor/mcp.json` (project-scoped) or `~/.cursor/mcp.json` (global) |
| **Codex CLI** | `~/.codex/config.toml` (Codex uses TOML; transcribe the JSON manually) |

After registering, run your client's MCP list command (`/mcp` in Claude Code,
"MCP Servers" panel in Cursor) and confirm the MFP tools appear.

## Behavior

- **Tool names** match backend action IDs exactly (`lcms.list_sessions`,
  `lcms.find_mz`, etc.).
- **Catalog** is fetched at startup and cached for 30 seconds. The cache is
  invalidated automatically when the client calls a tool name we don't yet
  know about (so newly-added backend actions appear without restarting the
  MCP server).
- **Safe** backend actions execute immediately and return their structured
  result.
- **Confirm** / **destructive** actions hit `/preview` first and return a
  `requires_confirmation` payload (including a single-use confirmation token,
  5-minute TTL). They do **not** execute until the agent re-calls with the
  token.
- **Browser-scope** actions return `requires_open_app` early — they are
  surfaced once the browser bridge (phase 4) is in place.
- **HTTP errors** from the backend become structured `backend_error` payloads
  with the original status code and detail body.
- **Network errors** become structured `backend_unavailable` payloads.

All non-success responses are returned with `isError=true` so MCP clients
surface them to the user rather than mistaking them for normal results.

## Tests

```powershell
pip install -e ".[test]"
pytest tests/
```
