# Troubleshooting Guide

This guide covers common issues encountered when setting up, developing, or running SRE Studio on Windows, macOS, and Linux.

---

## 1. Environment & Setup Issues

### `sre-studio: command not found`
- **Cause**: CLI package has not been linked globally or built.
- **Solution**:
  ```bash
  pnpm run build
  cd packages/cli
  pnpm link --global
  ```
  Ensure pnpm's global bin directory is in your system `PATH`.

### `Node.js >= 20.0.0 is required`
- **Cause**: You are running Node.js 18 or older.
- **Solution**: Upgrade to Node.js 20 LTS or 22 LTS via [nvm](https://github.com/nvm-sh/nvm) or [nvm-windows](https://github.com/coreybutler/nvm-windows).

---

## 2. External Tool Issues

### `ToolExecutionError: rizin is not available` / `No provider found for capability`
- **Cause**: Rizin or `rabin2` is not installed or not in system `PATH`.
- **Solution**:
  - Run `sre-studio doctor` to confirm tool status.
  - Install Rizin via `winget install RizinOrg.Rizin` or `scoop install rizin`.
  - Restart your terminal after updating `PATH`.

### `aapt2` is missing or fails on APK inspection
- **Cause**: Android SDK build-tools are not installed or Android Studio path is not standard.
- **Solution**:
  - Install Android SDK Build-Tools via Android Studio: `Settings -> Appearance & Behavior -> System Settings -> Android SDK -> SDK Tools -> Android SDK Build-Tools`.
  - Add the build-tools folder (e.g. `C:\Users\<User>\AppData\Local\Android\Sdk\build-tools\34.0.0`) to system `PATH`.

### Java heap error when decompiling large APK with JADX
- **Cause**: Default JVM heap size exhausted by JADX.
- **Solution**:
  - Set JVM options environment variable:
    ```bash
    export JAVA_OPTS="-Xmx4096m"
    # Or in PowerShell:
    $env:JAVA_OPTS = "-Xmx4096m"
    ```

---

## 3. MCP Server Issues

### MCP Client fails to connect over stdio
- **Cause**: JSON-RPC stream corrupted by spurious console logs.
- **Solution**:
  - SRE Studio routes all logging to stderr or Pino with `SRE_LOG_LEVEL=warn`.
  - Ensure your MCP config sets:
    ```json
    "env": {
      "SRE_LOG_LEVEL": "warn"
    }
    ```
  - Verify server starts directly without error:
    ```bash
    node packages/mcp-server/dist/server.js
    ```

### Codex CLI reports configuration syntax error
- **Cause**: Using JSON instead of native TOML for Codex CLI.
- **Solution**:
  - Codex CLI requires TOML in `~/.codex/config.toml` under `[mcp_servers.sre-studio]`.
  - See [MCP Client Integration Guide](mcp-configuration.md#3-codex-cli-native-configuration) for the exact format.

---

## 4. SQLite & Permission Issues

### `SQLITE_BUSY` or `database is locked`
- **Cause**: Another process holds a lock on `investigation.db`.
- **Solution**:
  - SRE Studio configures SQLite in WAL (Write-Ahead Logging) mode.
  - Ensure previous CLI or MCP server sessions were closed with `sre-studio close` or terminated cleanly.
  - Do not place `investigation.db` on network shares or cloud-synced folders (OneDrive/Dropbox) where file locking is erratic.

### `AuthorizationError: Target not authorized`
- **Cause**: The file path you are attempting to analyze is outside the configured `.sre/boundaries.json`.
- **Solution**:
  - Check `.sre/boundaries.json` in your project root.
  - Register the target using `sre-studio target add <path>` to update boundaries, or update `allowedTargets` in `.sre/boundaries.json`.

