# Installation & Setup Guide

This guide covers installing and setting up SRE Studio on Windows, macOS, and Linux.

## System Requirements

- **Node.js**: `>= 20.0.0` (**Node 20 LTS** or **Node 22 LTS** strongly recommended).
  > [!TIP]
  > The underlying SQLite persistence library (`better-sqlite3`) publishes official precompiled binaries for Node 20 and Node 22. If running on a non-LTS development release (e.g. Node 24), Visual Studio C++ Build Tools (Windows) or `build-essential` (Linux) are required to compile native addons.
- **Package Manager**: pnpm >= 9.0.0 (`npm install -g pnpm`)
- **Operating System**: Windows 10/11, Windows Server 2022, macOS 12+, or Ubuntu 22.04+
- **Memory**: 4 GB RAM minimum (8 GB recommended for large APK decompilation)
- **Disk Space**: ~500 MB for SRE Studio and dependencies

## Automated Setup (Windows)

For Windows developers, an automated setup script is provided:

```powershell
.\scripts\dev-setup.ps1
```

This script:
1. Verifies Node.js >= 20 and pnpm.
2. Runs `pnpm install` across all packages.
3. Builds all TypeScript packages with `tsup`.
4. Synthesizes authorized test fixtures (`sample.exe`, `sample.elf`, `sample.apk`).
5. Executes the test suite.
6. Runs `sre-studio doctor` to report system diagnostics.

## Manual Installation

### 1. Clone the Repository
```bash
git clone https://github.com/organization/software-reverse-engineering-studio.git
cd software-reverse-engineering-studio
```

### 2. Install Monorepo Dependencies
```bash
pnpm install
```

### 3. Build All Packages
```bash
pnpm run build
```

### 4. Link CLI Globally (Optional)
```bash
cd packages/cli
pnpm link --global
```

Verify the installation:
```bash
sre-studio --version
sre-studio doctor
```

## External Reverse Engineering Tools

SRE Studio connects to external reverse engineering tools via safe child process execution. These tools are optional at install time; SRE Studio will report missing tools and fall back gracefully:

| Tool | Purpose | Windows Install | macOS Install | Linux Install |
|------|---------|-----------------|---------------|---------------|
| **Rizin** & `rabin2` | Binary disassembly & symbols | `winget install RizinOrg.Rizin` | `brew install rizin` | `apt install rizin` |
| **Android SDK Build-Tools** (`aapt2`, `apksigner`) | APK manifest & signature inspection | Android Studio SDK Manager or `sdkmanager` | `brew install android-commandlinetools` | `apt install aapt` |
| **JADX** | DEX to Java decompilation | `scoop install jadx` or GitHub Release | `brew install jadx` | `apt install jadx` |
| **Apktool** | APK to Smali decoding | `scoop install apktool` or Manual jar | `brew install apktool` | `apt install apktool` |

To diagnose tool availability on Windows without installing anything:
```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-providers.ps1
```

