#Requires -Version 5.1
<#
.SYNOPSIS
    MAOTANG Protocol - Alpha Testnet one-click launcher (Windows PowerShell).

.DESCRIPTION
    Brings the protocol up on a local chain:

      1. Reuse MAOTANG_RPC_URL, or a node already listening on :8545; otherwise spawn
         `anvil --block-time 2`, falling back to the built-in Node mock RPC server when Foundry
         is not installed.
      2. Build the Foundry artifacts and install the deployment toolchain when they are missing,
         then deploy the protocol set and write frontend/config/contracts.json.
      3. Start the agent-client video worker, watching MemeTokenCreated on the new factory.
      4. Start the Next.js launchpad frontend in the foreground.

    Ctrl-C (or closing the window) tears down anything this script started.

.PARAMETER SkipDeploy
    Reuse the existing frontend/config/contracts.json instead of deploying again.

.PARAMETER SkipWorker
    Do not start the video worker daemon.

.PARAMETER SkipFrontend
    Do not start Next.js; exit once the worker is up.

.PARAMETER KeepAnvil
    Leave a spawned anvil running after the script exits. Does not apply to the built-in mock RPC
    server, which is always stopped.

.EXAMPLE
    ./scripts/start-alpha.ps1
    ./scripts/start-alpha.ps1 -SkipFrontend -KeepAnvil
#>
[CmdletBinding()]
param(
    [switch]$SkipDeploy,
    [switch]$SkipWorker,
    [switch]$SkipFrontend,
    [switch]$KeepAnvil
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$ContractsDir = Join-Path $RepoRoot 'contracts'
$AgentClientDir = Join-Path $RepoRoot 'agent-client'
$FrontendDir = Join-Path $RepoRoot 'frontend'
$ContractsJson = Join-Path $FrontendDir 'config/contracts.json'
$LogDir = Join-Path $RepoRoot 'runtime_data/logs'

$AnvilPort = if ($env:ANVIL_PORT) { [int]$env:ANVIL_PORT } else { 8545 }
$AnvilBlockTime = if ($env:ANVIL_BLOCK_TIME) { [int]$env:ANVIL_BLOCK_TIME } else { 2 }
$DefaultRpc = "http://127.0.0.1:$AnvilPort"

# Public Anvil development key #0 (mnemonic "test test ... junk"). Not a secret: it is a documented
# constant controlling a throwaway local account. Override with DEPLOYER_PRIVATE_KEY.
$AnvilDevKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
# Address of that same development key, used to detect an unfunded default deployer.
$AnvilDevAddress = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
# Stand-in graduation market for a chain with no Uniswap deployment. Set
# UNISWAP_V3_POSITION_MANAGER to point at a real position manager.
$LocalMarketStandIn = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
# Stand-in registered agent address proofs are attributed to, until a real agent registers.
$LocalAgent = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'

$script:AnvilProcess = $null
$script:MockRpcProcess = $null
$script:WorkerProcess = $null
$script:AnvilLog = $null
$script:MockRpcLog = $null
$script:WorkerLog = $null

function Write-Step {
    param([string]$Message)
    Write-Host ''
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Note {
    param([string]$Message)
    Write-Host "    $Message" -ForegroundColor DarkGray
}

function Write-Warn {
    param([string]$Message)
    Write-Host "    WARNING: $Message" -ForegroundColor Yellow
}

# Resolves a command to a form Start-Process can launch. PowerShell exposes shim names such as
# `npm` as both an ExternalScript (npm.ps1) and an Application (npm.cmd); the .ps1 wins
# Get-Command but cannot be handed to Start-Process, so executable forms are preferred.
function Find-Command {
    param([string]$Name)
    if (Test-Path -LiteralPath $Name) { return (Resolve-Path -LiteralPath $Name).Path }
    $found = Get-Command $Name -All -ErrorAction SilentlyContinue
    if (-not $found) { return $null }
    $application = $found | Where-Object { $_.CommandType -eq 'Application' } | Select-Object -First 1
    if ($application) { return $application.Source }
    return ($found | Select-Object -First 1).Source
}

function Get-Property {
    param($Object, [string]$Name)
    if ($null -eq $Object) { return $null }
    $property = $Object.PSObject.Properties[$Name]
    if ($property) { return $property.Value }
    return $null
}

function Test-Rpc {
    param([string]$Url, [int]$TimeoutSec = 3)
    try {
        $body = '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
        $response = Invoke-RestMethod -Uri $Url -Method Post -ContentType 'application/json' -Body $body -TimeoutSec $TimeoutSec
        return $null -ne $response.result
    } catch {
        return $false
    }
}

function Wait-Rpc {
    param([string]$Url, [int]$TimeoutSec = 40)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        if (Test-Rpc -Url $Url -TimeoutSec 2) { return $true }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

function Test-NodeStripsTypes {
    $node = Find-Command 'node'
    if (-not $node) { return $false }
    try {
        $version = (& $node --version).Trim() -replace '^v', ''
        $parts = $version.Split('.')
        $major = [int]$parts[0]
        $minor = [int]$parts[1]
        return ($major -gt 22) -or (($major -eq 22) -and ($minor -ge 18))
    } catch {
        return $false
    }
}

# Runs a command in the foreground and throws on a non-zero exit.
function Invoke-Checked {
    param([string]$File, [string[]]$Arguments, [string]$WorkingDirectory)
    $resolved = Find-Command $File
    if (-not $resolved) { throw "cannot find '$File' on PATH" }
    Write-Note "> $File $($Arguments -join ' ')"
    $process = Start-Process -FilePath $resolved -ArgumentList $Arguments -WorkingDirectory $WorkingDirectory -NoNewWindow -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "$File exited with code $($process.ExitCode)" }
}

function Initialize-Anvil {
    if ($env:MAOTANG_RPC_URL) {
        if (Test-Rpc -Url $env:MAOTANG_RPC_URL) {
            Write-Note "using MAOTANG_RPC_URL=$($env:MAOTANG_RPC_URL)"
            return $env:MAOTANG_RPC_URL
        }
        throw "MAOTANG_RPC_URL=$($env:MAOTANG_RPC_URL) is set but does not answer eth_chainId"
    }

    if (Test-Rpc -Url $DefaultRpc) {
        Write-Note "reusing the node already listening on $DefaultRpc"
        return $DefaultRpc
    }

    New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

    $anvil = Find-Command 'anvil'
    if ($anvil) {
        $script:AnvilLog = Join-Path $LogDir 'alpha-anvil.log'
        Write-Note "spawning: anvil --block-time $AnvilBlockTime --port $AnvilPort"
        $script:AnvilProcess = Start-Process -FilePath $anvil `
            -ArgumentList @('--block-time', "$AnvilBlockTime", '--port', "$AnvilPort") `
            -PassThru -WindowStyle Hidden `
            -RedirectStandardOutput $script:AnvilLog `
            -RedirectStandardError "$($script:AnvilLog).err"

        if (-not (Wait-Rpc -Url $DefaultRpc)) {
            throw "anvil did not become reachable on $DefaultRpc; see $($script:AnvilLog)"
        }
        return $DefaultRpc
    }

    # No chain binary on PATH: fall back to the zero-dependency Node mock so the deployment pipeline
    # can still be exercised end to end.
    Write-Host "[Notice] 'anvil' not found. Launching built-in Node Mock RPC server ($DefaultRpc)..."

    $node = Find-Command 'node'
    if (-not $node) {
        throw "no RPC endpoint is reachable, 'anvil' is not on PATH and 'node' is not on PATH either. Install Foundry (https://getfoundry.sh), install Node, or set MAOTANG_RPC_URL."
    }
    $mockRpc = Join-Path $RepoRoot 'scripts/mock-rpc.js'
    if (-not (Test-Path -LiteralPath $mockRpc)) { throw "missing $mockRpc" }

    $script:MockRpcLog = Join-Path $LogDir 'alpha-mock-rpc.log'
    $env:MOCK_RPC_PORT = "$AnvilPort"
    $script:MockRpcProcess = Start-Process -FilePath $node `
        -ArgumentList @("`"$mockRpc`"") `
        -WorkingDirectory $RepoRoot -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput "$($script:MockRpcLog).out" `
        -RedirectStandardError $script:MockRpcLog

    if (-not (Wait-Rpc -Url $DefaultRpc)) {
        throw "the built-in mock RPC server did not become reachable on $DefaultRpc; see $($script:MockRpcLog)"
    }
    Write-Note "mock RPC pid $($script:MockRpcProcess.Id), log: $($script:MockRpcLog)"
    $env:MAOTANG_RPC_URL = $DefaultRpc
    return $DefaultRpc
}

function Initialize-Contracts {
    if (-not (Test-Path (Join-Path $ContractsDir 'out'))) {
        $forge = Find-Command 'forge'
        if (-not $forge) {
            throw "contracts/out is missing and 'forge' is not on PATH. Run 'forge build' in contracts/ first."
        }
        Invoke-Checked -File 'forge' -Arguments @('build') -WorkingDirectory $ContractsDir
    }
    if (-not (Test-Path (Join-Path $ContractsDir 'node_modules/ethers'))) {
        Invoke-Checked -File 'npm' -Arguments @('install', '--no-audit', '--no-fund') -WorkingDirectory $ContractsDir
    }
}

# Prefers Node's native TypeScript execution; falls back to a locally installed runner.
function Resolve-DeployCommand {
    $deployScript = Join-Path $ContractsDir 'scripts/deploy-testnet.ts'
    if (-not (Test-Path $deployScript)) { throw "missing $deployScript" }

    if (Test-NodeStripsTypes) {
        return @{ File = 'node'; Arguments = @($deployScript) }
    }
    foreach ($runner in @('tsx', 'ts-node')) {
        $candidate = Join-Path $ContractsDir "node_modules/.bin/$runner.cmd"
        if (Test-Path $candidate) {
            return @{ File = $candidate; Arguments = @($deployScript) }
        }
    }
    throw "this Node cannot execute TypeScript directly. Install tsx or ts-node in contracts/, or use Node >= 22.18."
}

# Loopback endpoints are disposable local chains; anything else spends real funds against a real
# graduation market, so those two inputs are validated before a single transaction is attempted.
function Test-PublicRpc {
    param([string]$Url)

    $uri = $null
    try { $uri = [System.Uri]$Url } catch { return $true }
    if (-not $uri -or -not $uri.IsAbsoluteUri) { return $true }

    if ($uri.IsLoopback) { return $false }

    # Uri.Host pads IPv6 literals to eight groups on .NET Framework, so canonicalise via DnsSafeHost.
    $bare = $uri.DnsSafeHost.Trim('[', ']').ToLowerInvariant()
    if (-not $bare) { return $false }
    if ($bare -eq '0.0.0.0' -or $bare -eq '::' -or $bare -eq '::1') { return $false }
    if ($bare -eq '0000:0000:0000:0000:0000:0000:0000:0001') { return $false }
    if ($bare -match '^127\.') { return $false }
    return $true
}

function Assert-DeployPreflight {
    param([string]$RpcUrl)

    if (-not (Test-PublicRpc -Url $RpcUrl)) { return }

    $deployerKey = if ($env:DEPLOYER_PRIVATE_KEY) { $env:DEPLOYER_PRIVATE_KEY } elseif ($env:PRIVATE_KEY) { $env:PRIVATE_KEY } else { '' }

    if (-not $deployerKey) {
        throw (@(
            "MAOTANG_RPC_URL=$RpcUrl is a public network, but no deployer key is set.",
            'Without one the launcher falls back to the public Anvil development key, whose address',
            "$AnvilDevAddress holds no funds there, so the deployment would fail with INSUFFICIENT_FUNDS.",
            '',
            'Set a funded account, then re-run:',
            "    `$env:DEPLOYER_PRIVATE_KEY = '0x...'",
            '    .\scripts\start-alpha.ps1'
        ) -join [Environment]::NewLine)
    }

    if ($deployerKey.ToLowerInvariant() -eq $AnvilDevKey.ToLowerInvariant()) {
        throw (@(
            "MAOTANG_RPC_URL=$RpcUrl is a public network, but the deployer is still the public Anvil",
            "development key (address $AnvilDevAddress). That account holds no funds there.",
            '',
            'Set a funded account, then re-run:',
            "    `$env:DEPLOYER_PRIVATE_KEY = '0x...'",
            '    .\scripts\start-alpha.ps1'
        ) -join [Environment]::NewLine)
    }

    if ($env:PRIVATE_KEY -and -not $env:DEPLOYER_PRIVATE_KEY) {
        $env:DEPLOYER_PRIVATE_KEY = $env:PRIVATE_KEY
        Write-Note 'using PRIVATE_KEY as DEPLOYER_PRIVATE_KEY'
    }

    if (-not $env:UNISWAP_V3_POSITION_MANAGER) {
        Write-Warn "UNISWAP_V3_POSITION_MANAGER is unset while deploying to $RpcUrl."
        Write-Warn "Graduation would be pinned to the stand-in address $LocalMarketStandIn, which is not a"
        Write-Warn 'real Uniswap V3 position manager on a public chain.'
        Write-Warn 'Set it to the target chain nonfungible position manager, e.g. Base Sepolia:'
        Write-Warn "    `$env:UNISWAP_V3_POSITION_MANAGER = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1'"
    }
}

function Invoke-Deploy {
    param([string]$RpcUrl)

    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ContractsJson) | Out-Null

    Assert-DeployPreflight -RpcUrl $RpcUrl

    # deploy-testnet.ts reads MAOTANG_TESTNET_RPC_URL (falling back to TESTNET_RPC_URL).
    $env:MAOTANG_TESTNET_RPC_URL = $RpcUrl

    $marketOverride = [bool]$env:UNISWAP_V3_POSITION_MANAGER
    if (-not $env:DEPLOYER_PRIVATE_KEY) { $env:DEPLOYER_PRIVATE_KEY = $AnvilDevKey }
    if (-not $env:MAOTANG_OWNER) { $env:MAOTANG_OWNER = $LocalAgent }
    if (-not $env:MAOTANG_SHARE_BASE_URL) { $env:MAOTANG_SHARE_BASE_URL = 'http://127.0.0.1:3000' }
    if (-not $marketOverride) {
        $env:UNISWAP_V3_POSITION_MANAGER = $LocalMarketStandIn
        Write-Note "UNISWAP_V3_POSITION_MANAGER unset; using the stand-in market ($LocalMarketStandIn)"
    }

    $deploy = Resolve-DeployCommand
    Invoke-Checked -File $deploy.File -Arguments $deploy.Arguments -WorkingDirectory $ContractsDir

    if (-not (Test-Path $ContractsJson)) { throw "deployment did not write $ContractsJson" }
    return Get-Content $ContractsJson -Raw | ConvertFrom-Json
}

function Start-VideoWorker {
    param([string]$RpcUrl, [string]$FactoryAddress)

    $distEntry = Join-Path $AgentClientDir 'dist/video-worker.js'
    if (-not (Test-Path $distEntry)) {
        if (-not (Test-Path (Join-Path $AgentClientDir 'node_modules'))) {
            Invoke-Checked -File 'npm' -Arguments @('install', '--no-audit', '--no-fund') -WorkingDirectory $AgentClientDir
        }
        Invoke-Checked -File 'npm' -Arguments @('run', 'build') -WorkingDirectory $AgentClientDir
    }
    if (-not (Test-Path $distEntry)) { throw "missing $distEntry after build" }

    $env:MAOTANG_RPC_URL = $RpcUrl
    $env:MAOTANG_FACTORY_ADDRESS = $FactoryAddress
    if (-not $env:MAOTANG_AGENT_ID) { $env:MAOTANG_AGENT_ID = $LocalAgent }
    if (-not $env:MAOTANG_TELEMETRY_URL) { $env:MAOTANG_TELEMETRY_URL = 'http://127.0.0.1:8787/telemetry/proof' }
    if (-not $env:MAOTANG_VIDEO_OUTPUT) { $env:MAOTANG_VIDEO_OUTPUT = Join-Path $RepoRoot 'runtime_data/video-promos' }

    New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
    $script:WorkerLog = Join-Path $LogDir 'alpha-video-worker.log'
    $node = Find-Command 'node'
    if (-not $node) { throw "cannot find 'node' on PATH" }
    $script:WorkerProcess = Start-Process -FilePath $node -ArgumentList @('dist/video-worker.js') `
        -WorkingDirectory $AgentClientDir -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput "$($script:WorkerLog).out" `
        -RedirectStandardError $script:WorkerLog
    Write-Note "video worker pid $($script:WorkerProcess.Id), log: $($script:WorkerLog)"
}

function Start-Frontend {
    param([hashtable]$FrontendEnv)

    foreach ($key in $FrontendEnv.Keys) { Set-Item -Path "env:$key" -Value $FrontendEnv[$key] }
    if (-not (Test-Path (Join-Path $FrontendDir 'node_modules'))) {
        Invoke-Checked -File 'npm' -Arguments @('install', '--no-audit', '--no-fund') -WorkingDirectory $FrontendDir
    }
    $npm = Find-Command 'npm'
    if (-not $npm) { throw "cannot find 'npm' on PATH" }

    Write-Host ''
    Write-Host '==> Next.js launchpad: http://127.0.0.1:3000  (Ctrl-C to stop)' -ForegroundColor Green
    Push-Location $FrontendDir
    try {
        & $npm run dev
    } finally {
        Pop-Location
    }
}

function Stop-Spawned {
    if ($script:WorkerProcess -and -not $script:WorkerProcess.HasExited) {
        Write-Note "stopping video worker (pid $($script:WorkerProcess.Id))"
        Stop-Process -Id $script:WorkerProcess.Id -Force -ErrorAction SilentlyContinue
    }
    if ($script:AnvilProcess -and -not $KeepAnvil -and -not $script:AnvilProcess.HasExited) {
        Write-Note "stopping anvil (pid $($script:AnvilProcess.Id))"
        Stop-Process -Id $script:AnvilProcess.Id -Force -ErrorAction SilentlyContinue
    }    # The mock is an ephemeral dry-run fixture with no state worth keeping, so it always stops.
    if ($script:MockRpcProcess -and -not $script:MockRpcProcess.HasExited) {
        Write-Note "stopping mock RPC (pid $($script:MockRpcProcess.Id))"
        Stop-Process -Id $script:MockRpcProcess.Id -Force -ErrorAction SilentlyContinue
    }
}

try {
    Write-Host 'MAOTANG Protocol - Alpha Testnet launcher' -ForegroundColor Magenta
    Write-Note "repository: $RepoRoot"

    Write-Step '1/4  resolving the RPC endpoint'
    $rpcUrl = Initialize-Anvil

    if ($SkipDeploy) {
        Write-Step '2/4  deployment skipped; reading the existing contracts.json'
        if (-not (Test-Path $ContractsJson)) { throw "-SkipDeploy was passed but $ContractsJson does not exist" }
        $deployment = Get-Content $ContractsJson -Raw | ConvertFrom-Json
    } else {
        Write-Step '2/4  building and deploying the protocol set'
        Initialize-Contracts
        $deployment = Invoke-Deploy -RpcUrl $rpcUrl
    }

    $contracts = Get-Property $deployment 'contracts'
    $factory = Get-Property $contracts 'MaoTangFactory'
    if (-not $factory) { throw 'contracts.json has no contracts.MaoTangFactory entry' }
    Write-Note "factory (bonding-curve router): $factory"
    Write-Note "vault: $(Get-Property $contracts 'MaoTangSustenanceVault')   mHUMAN: $(Get-Property $contracts 'HumanToken')"

    if ($SkipWorker) {
        Write-Step '3/4  video worker skipped'
    } else {
        Write-Step '3/4  starting the video worker daemon'
        Start-VideoWorker -RpcUrl $rpcUrl -FactoryAddress $factory
    }

    if ($SkipFrontend) {
        Write-Step '4/4  frontend skipped'
        Write-Host ''
        Write-Host "Alpha testnet is up. RPC=$rpcUrl factory=$factory" -ForegroundColor Green
        if (-not $KeepAnvil) { Write-Note 'exiting; spawned processes will be stopped (use -KeepAnvil to keep anvil)' }
    } else {
        Write-Step '4/4  starting the frontend'
        $frontendEnv = @{}
        $exports = Get-Property $deployment 'frontendEnv'
        if ($exports) {
            foreach ($property in $exports.PSObject.Properties) {
                if ($property.Value) { $frontendEnv[$property.Name] = [string]$property.Value }
            }
        }
        # The live RPC wins over whatever the export recorded.
        $frontendEnv['NEXT_PUBLIC_MAOTANG_RPC_URL'] = $rpcUrl
        Start-Frontend -FrontendEnv $frontendEnv
    }
} finally {
    Stop-Spawned
}