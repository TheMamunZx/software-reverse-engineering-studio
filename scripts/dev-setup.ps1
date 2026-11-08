<#
.SYNOPSIS
    Development Environment Setup Script for SRE Studio (Windows).

.DESCRIPTION
    Validates Node.js and pnpm prerequisites, installs monorepo dependencies,
    builds all TypeScript packages, ensures test fixtures are generated,
    and runs the test suite and doctor diagnostics.

.EXAMPLE
    .\scripts\dev-setup.ps1
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "   SRE Studio - Developer Environment Setup (Windows)" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan

# 1. Check Node.js
Write-Host "`n[1/6] Checking Node.js runtime..." -ForegroundColor Yellow
try {
    $nodeVersion = node -v
    Write-Host "  Found Node.js: $nodeVersion" -ForegroundColor Green
    $major = [int]($nodeVersion -replace '^v(\d+)\..*$', '$1')
    if ($major -lt 20) {
        Write-Error "Node.js >= 20.0.0 is required. Current version: $nodeVersion"
        exit 1
    }
} catch {
    Write-Error "Node.js was not found on PATH. Please install Node.js 20+ from https://nodejs.org/"
    exit 1
}

# 2. Check pnpm
Write-Host "`n[2/6] Checking pnpm package manager..." -ForegroundColor Yellow
try {
    $pnpmVersion = pnpm -v
    Write-Host "  Found pnpm: $pnpmVersion" -ForegroundColor Green
} catch {
    Write-Host "  pnpm not found. Installing via corepack..." -ForegroundColor Yellow
    corepack enable
    corepack prepare pnpm@9.15.0 --activate
}

# 3. Install dependencies
Write-Host "`n[3/6] Installing dependencies across workspace..." -ForegroundColor Yellow
pnpm install

# 4. Build all packages
Write-Host "`n[4/6] Building all TypeScript packages (shared, core, providers, mcp-server, cli)..." -ForegroundColor Yellow
pnpm run build

# 5. Generate benign test fixtures if needed
Write-Host "`n[5/6] Verifying authorized benign test fixtures (PE, ELF, APK)..." -ForegroundColor Yellow
node scripts/generate-fixtures.mjs

# 6. Run test suite & doctor
Write-Host "`n[6/6] Running full test suite..." -ForegroundColor Yellow
pnpm run test

Write-Host "`nRunning SRE Studio Doctor diagnostics..." -ForegroundColor Yellow
node packages/cli/dist/index.js doctor

Write-Host "`n======================================================================" -ForegroundColor Green
Write-Host "   Setup Complete! SRE Studio is ready for development." -ForegroundColor Green
Write-Host "   To start the MCP server: pnpm --filter=@sre-studio/mcp-server start" -ForegroundColor Cyan
Write-Host "   To run benchmarks:       pnpm run benchmark" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Green

