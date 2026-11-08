<#
.SYNOPSIS
    Provider External Tool Diagnostic & Installation Helper for Windows.

.DESCRIPTION
    Inspects the Windows host for binary and Android reverse engineering tools
    (Rizin, rabin2, aapt2, apksigner, jadx, apktool) without automatic installation.
    Reports which real-world analysis capabilities are available vs blocked,
    and provides verified installation commands for Windows package managers
    (Winget, Scoop, Chocolatey) and manual releases.

.PARAMETER Interactive
    Prompts the user before invoking any package manager commands.

.EXAMPLE
    .\scripts\install-providers.ps1
    .\scripts\install-providers.ps1 -Interactive
#>

[CmdletBinding()]
param(
    [switch]$Interactive
)

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "   SRE Studio - External Tool Diagnostics & Setup (Windows)" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan

function Test-CommandAvailable {
    param([string]$CommandName)
    $cmd = Get-Command $CommandName -ErrorAction SilentlyContinue
    return ($null -ne $cmd)
}

function Find-AndroidSdkTool {
    param([string]$ToolName)
    if (Test-CommandAvailable $ToolName) {
        return (Get-Command $ToolName).Source
    }
    $sdkPaths = @(
        "$env:LOCALAPPDATA\Android\Sdk\build-tools\*\$ToolName.exe",
        "$env:ANDROID_HOME\build-tools\*\$ToolName.exe",
        "$env:ANDROID_SDK_ROOT\build-tools\*\$ToolName.exe"
    )
    foreach ($p in $sdkPaths) {
        $found = Get-Item $p -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
        if ($found) {
            return $found.FullName
        }
    }
    return $null
}

$tools = @{
    'rizin'     = @{ Role = 'Binary disassembly, CFG & basic blocks'; Found = (Test-CommandAvailable 'rizin') }
    'rabin2'    = @{ Role = 'Binary header, sections & symbol extraction'; Found = (Test-CommandAvailable 'rabin2') }
    'aapt2'     = @{ Role = 'APK manifest, permissions & resource dumping'; Found = ($null -ne (Find-AndroidSdkTool 'aapt2')) }
    'apksigner' = @{ Role = 'APK v1/v2/v3 signature scheme verification'; Found = ($null -ne (Find-AndroidSdkTool 'apksigner')) }
    'jadx'      = @{ Role = 'DEX decompilation into high-level Java'; Found = (Test-CommandAvailable 'jadx') }
    'apktool'   = @{ Role = 'APK decoding into Smali IR & resources'; Found = (Test-CommandAvailable 'apktool') }
}

Write-Host "`nInstalled Status:" -ForegroundColor Yellow
$missing = @()
foreach ($k in $tools.Keys | Sort-Object) {
    $info = $tools[$k]
    if ($info.Found) {
        Write-Host "  [OK]      $k - $($info.Role)" -ForegroundColor Green
    } else {
        Write-Host "  [MISSING] $k - $($info.Role)" -ForegroundColor Red
        $missing += $k
    }
}

Write-Host "`nCapability Impact:" -ForegroundColor Yellow
if ($tools['rizin'].Found -and $tools['rabin2'].Found) {
    Write-Host "  Binary Analysis: Full (Disassembly, Decompilation, Strings, Sections)" -ForegroundColor Green
} else {
    Write-Host "  Binary Analysis: BLOCKED for live execution (Simulated / Fixture-only)" -ForegroundColor Red
}

if ($tools['aapt2'].Found) {
    Write-Host "  Android Manifest & Permissions: AVAILABLE (aapt2 detected)" -ForegroundColor Green
} else {
    Write-Host "  Android Manifest & Permissions: BLOCKED" -ForegroundColor Red
}

if ($tools['jadx'].Found -and $tools['apktool'].Found) {
    Write-Host "  Android Decompilation: Full (Java & Smali analysis active)" -ForegroundColor Green
} else {
    Write-Host "  Android Decompilation: BLOCKED for live disassembly (Simulated / Fixture-only)" -ForegroundColor Red
}

if ($missing.Count -eq 0) {
    Write-Host "`nAll external reverse-engineering tools are installed and operational!" -ForegroundColor Green
    exit 0
}

Write-Host "`nRecommended Installation Options for Missing Tools:" -ForegroundColor Cyan
Write-Host "----------------------------------------------------------------------"

if ($missing -contains 'rizin' -or $missing -contains 'rabin2') {
    Write-Host "`n[Rizin & rabin2]" -ForegroundColor Yellow
    Write-Host "  Winget:  winget install RizinOrg.Rizin" -ForegroundColor White
    Write-Host "  Scoop:   scoop install rizin" -ForegroundColor White
    Write-Host "  GitHub:  https://github.com/rizinorg/rizin/releases (Download Windows zip, extract and add bin to PATH)" -ForegroundColor Gray
}

if ($missing -contains 'aapt2' -or $missing -contains 'apksigner') {
    Write-Host "`n[Android SDK Build-Tools (aapt2, apksigner)]" -ForegroundColor Yellow
    Write-Host "  Install via Android Studio SDK Manager: SDK Tools -> Android SDK Build-Tools" -ForegroundColor White
    Write-Host "  Or via command line:" -ForegroundColor White
    Write-Host "    sdkmanager `"build-tools;34.0.0`"" -ForegroundColor Gray
    Write-Host "  Add build-tools path to your system PATH." -ForegroundColor Gray
}

if ($missing -contains 'jadx') {
    Write-Host "`n[JADX Decompiler]" -ForegroundColor Yellow
    Write-Host "  Scoop:   scoop install jadx" -ForegroundColor White
    Write-Host "  GitHub:  https://github.com/skylot/jadx/releases (Download jadx-*.zip, extract and add bin to PATH)" -ForegroundColor Gray
}

if ($missing -contains 'apktool') {
    Write-Host "`n[Apktool]" -ForegroundColor Yellow
    Write-Host "  Scoop:   scoop install apktool" -ForegroundColor White
    Write-Host "  Manual:  https://ibotpeaches.github.io/Apktool/install/ (Follow Windows guide: apktool.jar + apktool.bat)" -ForegroundColor Gray
}

if ($Interactive) {
    Write-Host "`nInteractive installation is available via package managers." -ForegroundColor Yellow
    $confirm = Read-Host "Would you like to run 'winget install RizinOrg.Rizin' now? (y/N)"
    if ($confirm -eq 'y' -or $confirm -eq 'Y') {
        winget install RizinOrg.Rizin
    }
} else {
    Write-Host "`nNote: SRE Studio does not automatically install external tools without explicit authorization." -ForegroundColor DarkGray
    Write-Host "Run this script with -Interactive to prompt for installation, or use the commands above." -ForegroundColor DarkGray
}

Write-Host "======================================================================" -ForegroundColor Cyan

