<#
  Elowen bootstrap installer for Windows, via WSL2.

    irm https://raw.githubusercontent.com/dragocz95/elowen/main/install.ps1 | iex

  Elowen cannot run natively on Windows: tmux is the execution substrate for the whole
  daemon (agent spawn, brain worker, mission engine) and systemd/apt are Linux-only. So on
  Windows we install it inside WSL2, where the exact same Linux bootstrap (install.sh) runs.

  This script:
    1. ensures WSL2 + an Ubuntu distro (installing them if missing),
    2. enables systemd inside the distro (elowen install provisions systemd services),
    3. runs install.sh inside WSL, which finishes the full install.

  Run it in an ELEVATED PowerShell (Administrator) — enabling the WSL feature requires it.

  Environment overrides (forwarded into WSL):
    $env:ELOWEN_VERSION       install a specific npm version
    $env:ELOWEN_INSTALL_ARGS  extra flags forwarded to `elowen install`
#>

$ErrorActionPreference = 'Stop'

$Distro     = 'Ubuntu'
$RawBase    = 'https://raw.githubusercontent.com/dragocz95/elowen/main'
$InstallUrl = "$RawBase/install.sh"

function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "  ok $msg"  -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "warn $msg"  -ForegroundColor Yellow }
function Die($msg)        { Write-Host "error $msg" -ForegroundColor Red; exit 1 }

# ── admin check ──────────────────────────────────────────────────────────────
$isAdmin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()
  ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Die @"
This installer must run as Administrator (enabling WSL requires elevation).
Open PowerShell as Administrator, then run:
  irm $RawBase/install.ps1 | iex
"@
}

# ── WSL present? ─────────────────────────────────────────────────────────────
Write-Step 'Checking WSL'
$wsl = Get-Command wsl.exe -ErrorAction SilentlyContinue
if (-not $wsl) {
  Write-Step 'WSL is not installed — installing WSL2 with Ubuntu'
  # `wsl --install` enables the WSL/VM features and installs the default distro in one shot.
  wsl.exe --install -d $Distro
  Die @"
WSL was just installed. A RESTART is required to finish enabling it.
Please REBOOT Windows, then re-run this command to complete the Elowen install:
  irm $RawBase/install.ps1 | iex
"@
}

# WSL binary exists but the platform may still be mid-setup (feature enabled, needs reboot).
try { wsl.exe --set-default-version 2 | Out-Null } catch { Write-Warn "Could not set WSL default version to 2: $_" }

# ── distro present? ──────────────────────────────────────────────────────────
# `wsl -l -q` output is UTF-16 with stray NULs; strip them before matching.
$installed = (wsl.exe -l -q 2>$null) -replace "`0", '' | ForEach-Object { $_.Trim() } | Where-Object { $_ }
if ($installed -notcontains $Distro) {
  Write-Step "Installing the $Distro distro"
  wsl.exe --install -d $Distro
  Die @"
The $Distro distro was just installed. Finish its first-run setup (it may open a new window
to create a UNIX username and password), then re-run this command:
  irm $RawBase/install.ps1 | iex
"@
}
Write-Ok "$Distro is available"

# ── enable systemd inside the distro ─────────────────────────────────────────
# elowen install provisions systemd units, so the distro must boot with systemd. Write
# /etc/wsl.conf [boot] systemd=true (idempotent) and restart WSL so it takes effect.
Write-Step 'Enabling systemd inside WSL'
$wslConf = "[boot]`nsystemd=true`n"
# Pipe the config to `tee` as root; base64 avoids any quoting/newline mangling across the boundary.
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($wslConf))
wsl.exe -d $Distro -u root -- bash -c "echo $b64 | base64 -d | tee /etc/wsl.conf > /dev/null"
wsl.exe --terminate $Distro | Out-Null
Write-Ok 'systemd enabled (distro restarted)'

# ── run the Linux bootstrap inside WSL ───────────────────────────────────────
Write-Step 'Installing Elowen inside WSL'
# Forward the optional overrides so a single command configures the WSL-side install too.
$envPrefix = ''
if ($env:ELOWEN_VERSION)      { $envPrefix += "ELOWEN_VERSION='$($env:ELOWEN_VERSION)' " }
if ($env:ELOWEN_INSTALL_ARGS) { $envPrefix += "ELOWEN_INSTALL_ARGS='$($env:ELOWEN_INSTALL_ARGS)' " }

# Run as root so apt/systemd steps need no in-WSL password prompt. The interactive wizard
# inherits this terminal, so its prompts work. `bash -c "curl ... | bash"` mirrors the Linux one-liner.
wsl.exe -d $Distro -u root -- bash -c "$envPrefix curl -fsSL $InstallUrl | bash"

Write-Host ''
Write-Ok 'Elowen is installed inside WSL.'
Write-Host 'Open the Web UI from Windows at: ' -NoNewline; Write-Host 'http://localhost:4500' -ForegroundColor Cyan
Write-Host 'Manage it from a WSL shell:       ' -NoNewline; Write-Host "wsl -d $Distro" -ForegroundColor Cyan
