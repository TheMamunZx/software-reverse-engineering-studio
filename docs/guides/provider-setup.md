# Provider Setup & Verification Guide

SRE Studio features a pluggable provider architecture for reverse engineering engines. Providers register capabilities with the Core Engine and invoke external tools safely.

## 1. Binary Provider (`@sre-studio/provider-binary`)

The binary provider performs static reverse engineering on compiled executables (PE, ELF, Mach-O).

### External Tool Dependencies
- **Rizin**: Free and open-source reverse engineering framework (fork of Radare2). Used for disassembly, control flow analysis, and function discovery.
- **`rabin2`**: Binary extraction tool bundled with Rizin. Used for headers, sections, imports, exports, and ASCII/UTF-8 strings.

### Installation
#### Windows
```powershell
# Via Winget
winget install RizinOrg.Rizin

# Or via Scoop
scoop install rizin
```
Ensure `rizin.exe` and `rabin2.exe` are available on your system `PATH`.

#### Linux / macOS
```bash
# Ubuntu / Debian
sudo apt install rizin

# macOS
brew install rizin
```

### Capabilities Provided
- `binary.info`: Extract format, architecture, bits, endianness, and base address.
- `binary.sections`: Section table headers, permissions (rwx), virtual sizes, and raw sizes.
- `binary.imports`: Dynamic import symbols and referenced DLLs/shared libraries.
- `binary.exports`: Exported functions and ordinals.
- `binary.strings`: Extracted strings with minimum length filtering.
- `binary.disasm`: Disassembly of functions and instructions at specified offsets.

---

## 2. Android Provider (`@sre-studio/provider-android`)

The Android provider performs static inspection and decompilation of Android Application Packages (`.apk`).

### External Tool Dependencies
- **`aapt2`**: Android Asset Packaging Tool 2 (part of Android SDK Build-Tools).
- **`apksigner`**: Official APK signature verifier (part of Android SDK Build-Tools).
- **JADX**: DEX to Java decompiler.
- **Apktool**: Resource and Smali decompiler.

### Installation
#### Windows
```powershell
# 1. Android SDK Build-Tools (aapt2, apksigner)
# Available with Android Studio, or via sdkmanager:
sdkmanager "build-tools;34.0.0"

# 2. JADX and Apktool (via Scoop)
scoop install jadx apktool
```

#### Linux / macOS
```bash
# macOS
brew install android-commandlinetools jadx apktool

# Ubuntu / Debian
sudo apt install aapt apksigner jadx apktool
```

### Capabilities Provided
- `android.manifest`: Extracted `AndroidManifest.xml` structure, package name, version codes, min/target SDK versions, and application components.
- `android.permissions`: Declared, requested, and dangerous Android permissions.
- `android.signatures`: APK signing schemes (v1 JAR, v2 APK Signature Scheme, v3/v4), cert fingerprints, and debug key detection.
- `android.decompile`: High-level Java decompilation via JADX.
- `android.smali`: Smali intermediate representation disassembly via Apktool.

---

## Verification

To verify that your installed providers and tools are functioning:

```bash
sre-studio doctor
```

Or run the automated diagnostic script:
```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-providers.ps1
```

