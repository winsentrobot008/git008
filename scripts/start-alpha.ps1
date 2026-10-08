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
         then deploy the protocol set, write frontend/config/contracts.json, and perform the three
         owner-only calls the deploy script defers to the owner (setDripper,
         setOwnerSustenanceTarget, fundDripBudget).
      3. Start the agent-client video worker, watching MemeTokenCreated on the new factory.
      4. Start the Next.js launchpad frontend in the foreground.

    Ctrl-C (or closing the window) tears down anything this script started.

.PARAMETER SkipDeploy
    Reuse the existing frontend/config/contracts.json instead of deploying again.

.PARAMETER SkipOwnerWiring
    Do not sign the owner-only initialization calls after the deployment is resolved. The deploy script
    hands the vault and the verifier to MAOTANG_OWNER, so it reports vault.setDripper,
    setOwnerSustenanceTarget and fundDripBudget as deferred instead of attempting them; skipping this
    step leaves the dripper unable to pay out.

    Wiring signs as the deployment owner: MAOTANG_OWNER_PRIVATE_KEY when it is set, otherwise the public
    Anvil development key #1 on a loopback chain. Where the chain has received no native fees yet the
    vault is seeded with MAOTANG_DRIP_BUDGET_WEI (0.01 ETH by default), because fundDripBudget only ever
    reserves fees the vault has already received.

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
    [switch]$SkipOwnerWiring,
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

# Public Anvil development key #1, the owner `deploy-testnet.ts` hands the verifier and the vault to. Like
# the deployer key above this is a documented constant for a throwaway local account, not a secret.
# Override with MAOTANG_OWNER_PRIVATE_KEY when the owner is a different account.
$AnvilOwnerKey = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
# Address of that same development key, checked against the deployment owner before anything is signed.
$AnvilOwnerAddress = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
# Native budget the owner releases to the dripper during owner wiring, in wei (0.01 ETH). On a loopback
# chain that has received no fees yet this is also seeded into the vault, because `fundDripBudget` only
# ever reserves fees the vault has already received.
$OwnerDripBudgetWei = if ($env:MAOTANG_DRIP_BUDGET_WEI) { $env:MAOTANG_DRIP_BUDGET_WEI } else { '10000000000000000' }
# Zero address, used to detect an owner-side setting that is not wired yet.
$ZeroAddress = '0x0000000000000000000000000000000000000000'

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

# Runs `cast` and returns its last non-empty stdout line. Foundry loads a `.env` from the working directory
# and warns about the repository one on stderr, and a native command's stderr would terminate the launcher
# while `$ErrorActionPreference` is Stop, so the call runs from a scratch directory with a relaxed
# preference and the exit code alone decides success.
function Invoke-Cast {
    param([string]$Cast, [string[]]$Arguments, [string]$Operation)

    $previous = $ErrorActionPreference
    Push-Location ([System.IO.Path]::GetTempPath())
    try {
        $ErrorActionPreference = 'Continue'
        $output = & $Cast @Arguments 2>$null
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previous
        Pop-Location
    }
    if ($exitCode -ne 0) { throw ('cast {0} failed with exit code {1}' -f $Operation, $exitCode) }
    return (@($output) | Where-Object { $_ -ne '' } | Select-Object -Last 1)
}

# Reads a contract view function through eth_call. `cast` prints the value followed by a human-readable
# annotation when an integer is large, so only the first whitespace-delimited token is the value.
function Read-Contract {
    param([string]$Cast, [string]$RpcUrl, [string]$Target, [string]$Signature)

    $line = Invoke-Cast -Cast $Cast -Operation $Signature -Arguments @('call', $Target, $Signature, '--rpc-url', $RpcUrl)
    if (-not $line) { throw ('cast call {0} on {1} returned nothing' -f $Signature, $Target) }
    return ($line -split '\s+')[0]
}

# Signs and sends an owner transaction with `cast`. The private key is passed on the argument list, so this
# helper never echoes that list; callers log the operation they intended instead.
function Send-Contract {
    param([string]$Cast, [string]$RpcUrl, [string]$OwnerKey, [string]$Target, [string]$Signature,
        [string[]]$Arguments = @(), [string]$ValueWei)

    $castArguments = @('send', $Target)
    if ($Signature) { $castArguments += $Signature }
    if ($Arguments.Count -gt 0) { $castArguments += $Arguments }
    if ($ValueWei) { $castArguments += @('--value', $ValueWei) }
    $castArguments += @('--private-key', $OwnerKey, '--rpc-url', $RpcUrl)

    $operation = if ($Signature) { $Signature } else { 'native value transfer' }
    Invoke-Cast -Cast $Cast -Operation $operation -Arguments $castArguments | Out-Null
}

# Owner-side deferred initialization. `deploy-testnet.ts` deploys with the Anvil development key #0 but hands
# the vault and the verifier to MAOTANG_OWNER, so the three owner-only calls it reports as deferred are owner
# transactions rather than deployer transactions:
#
#   1. vault.setDripper(dripper)                  - bounds what the dripper may ever pay out
#   2. vault.setOwnerSustenanceTarget(operator)   - names the revenue beneficiary, on the vault and on the
#      dripper.setOwnerSustenanceTarget(operator)   dripper, that the deploy script would have wired itself
#                                                   if the deployer had been the owner
#   3. vault.fundDripBudget(amount)               - releases native fees the vault has already received
#
# Every step is skipped when the chain already holds the target state, so re-running against the same
# deployment is safe, and each result is read back through eth_call before the launcher continues.
function Invoke-OwnerWiring {
    param([string]$RpcUrl, $Deployment)

    $owner = Get-Property $Deployment 'owner'
    $contracts = Get-Property $Deployment 'contracts'
    $beneficiaries = Get-Property $Deployment 'beneficiaries'
    $vault = Get-Property $contracts 'MaoTangSustenanceVault'
    $dripper = Get-Property $contracts 'MaoTangSustenanceDripper'
    $operator = Get-Property $beneficiaries 'operator'

    if (-not $owner -or -not $vault -or -not $dripper -or -not $operator) {
        throw 'the deployment is missing owner, contracts.MaoTangSustenanceVault, contracts.MaoTangSustenanceDripper or beneficiaries.operator'
    }

    $cast = Find-Command 'cast'
    if (-not $cast) {
        Write-Warn 'Foundry `cast` is not on PATH, so the three owner-only calls were NOT performed.'
        Write-Warn ('The owner ({0}) still has to call vault.setDripper, setOwnerSustenanceTarget and fundDripBudget.' -f $owner)
        return
    }

    $ownerKey = $env:MAOTANG_OWNER_PRIVATE_KEY
    if (-not $ownerKey) {
        if ((Test-PublicRpc -Url $RpcUrl) -or ($owner.ToLowerInvariant() -ne $AnvilOwnerAddress.ToLowerInvariant())) {
            Write-Warn 'MAOTANG_OWNER_PRIVATE_KEY is unset and the deployment owner is not the local Anvil owner,'
            Write-Warn ('so the three owner-only calls were NOT performed. Owner: {0}.' -f $owner)
            return
        }
        $ownerKey = $AnvilOwnerKey
        Write-Note 'signing owner wiring with the public Anvil development key #1'
    }

    $signer = Invoke-Cast -Cast $cast -Operation 'wallet address' -Arguments @('wallet', 'address', '--private-key', $ownerKey)
    if (-not $signer) { throw 'cast wallet address returned nothing, so the owner signer could not be confirmed' }
    $signer = $signer.Trim()
    if ($signer.ToLowerInvariant() -ne $owner.ToLowerInvariant()) {
        throw ('the owner key signs as {0} but the deployment owner is {1}' -f $signer, $owner)
    }

    # 1. vault.setDripper - without it the dripper cannot reach the budget step 3 releases.
    $wireDripper = Read-Contract -Cast $cast -RpcUrl $RpcUrl -Target $vault -Signature 'dripper()(address)'
    if ($wireDripper.ToLowerInvariant() -ne $dripper.ToLowerInvariant()) {
        Write-Note ('vault.setDripper({0})' -f $dripper)
        Send-Contract -Cast $cast -RpcUrl $RpcUrl -OwnerKey $ownerKey -Target $vault `
            -Signature 'setDripper(address)' -Arguments @($dripper)
        $wireDripper = Read-Contract -Cast $cast -RpcUrl $RpcUrl -Target $vault -Signature 'dripper()(address)'
    }
    if ($wireDripper.ToLowerInvariant() -ne $dripper.ToLowerInvariant()) {
        throw ('vault.dripper() is {0}, expected {1}' -f $wireDripper, $dripper)
    }
    Write-Note ('verified vault.dripper() = {0}' -f $wireDripper)

    # 2. name the revenue beneficiary on the vault and on the dripper.
    $vaultTarget = Read-Contract -Cast $cast -RpcUrl $RpcUrl -Target $vault -Signature 'ownerSustenanceTarget()(address)'
    if ($vaultTarget.ToLowerInvariant() -eq $ZeroAddress) {
        Write-Note ('vault.setOwnerSustenanceTarget({0})' -f $operator)
        Send-Contract -Cast $cast -RpcUrl $RpcUrl -OwnerKey $ownerKey -Target $vault `
            -Signature 'setOwnerSustenanceTarget(address)' -Arguments @($operator)
        $vaultTarget = Read-Contract -Cast $cast -RpcUrl $RpcUrl -Target $vault -Signature 'ownerSustenanceTarget()(address)'
    }
    $dripperTarget = Read-Contract -Cast $cast -RpcUrl $RpcUrl -Target $dripper -Signature 'ownerSustenanceTarget()(address)'
    if ($dripperTarget.ToLowerInvariant() -eq $ZeroAddress) {
        Write-Note ('dripper.setOwnerSustenanceTarget({0})' -f $operator)
        Send-Contract -Cast $cast -RpcUrl $RpcUrl -OwnerKey $ownerKey -Target $dripper `
            -Signature 'setOwnerSustenanceTarget(address)' -Arguments @($operator)
        $dripperTarget = Read-Contract -Cast $cast -RpcUrl $RpcUrl -Target $dripper -Signature 'ownerSustenanceTarget()(address)'
    }
    if ($vaultTarget.ToLowerInvariant() -ne $operator.ToLowerInvariant() -or
        $dripperTarget.ToLowerInvariant() -ne $operator.ToLowerInvariant()) {
        throw ('ownerSustenanceTarget is vault={0} dripper={1}, expected {2} on both' -f $vaultTarget, $dripperTarget, $operator)
    }
    Write-Note ('verified vault + dripper ownerSustenanceTarget() = {0}' -f $operator)

    # 3. release native fees to the dripper. fundDripBudget only ever reserves fees the vault has already
    # received, so a chain that has processed no swaps has nothing to reserve: a loopback chain is seeded
    # with a small, labelled smoke value first, while a public chain is left for the owner to fund once real
    # fees have accrued.
    $unspent = Read-Contract -Cast $cast -RpcUrl $RpcUrl -Target $vault -Signature 'unspentDripNative()(uint256)'
    if ([decimal]$unspent -gt 0) {
        Write-Note ('vault drip budget already funded; unspentDripNative() = {0}' -f $unspent)
    } else {
        $unreserved = Read-Contract -Cast $cast -RpcUrl $RpcUrl -Target $vault -Signature 'unreservedNative()(uint256)'
        if ([decimal]$unreserved -le 0) {
            if (Test-PublicRpc -Url $RpcUrl) {
                Write-Warn 'the vault holds no unreserved native fees, so vault.fundDripBudget was NOT called.'
                Write-Warn 'Reserving fees the vault has not received would revert; the owner funds the budget once fees accrue.'
            } else {
                Write-Note ('seeding {0} wei of native fees on the local chain (smoke value) so the drip budget is exercisable' -f $OwnerDripBudgetWei)
                Send-Contract -Cast $cast -RpcUrl $RpcUrl -OwnerKey $ownerKey -Target $vault -ValueWei $OwnerDripBudgetWei
                $unreserved = Read-Contract -Cast $cast -RpcUrl $RpcUrl -Target $vault -Signature 'unreservedNative()(uint256)'
            }
        }
        if ([decimal]$unreserved -gt 0) {
            $amount = if ([decimal]$OwnerDripBudgetWei -lt [decimal]$unreserved) { [decimal]$OwnerDripBudgetWei } else { [decimal]$unreserved }
            $amountWei = $amount.ToString([System.Globalization.CultureInfo]::InvariantCulture)
            Write-Note ('vault.fundDripBudget({0})' -f $amountWei)
            Send-Contract -Cast $cast -RpcUrl $RpcUrl -OwnerKey $ownerKey -Target $vault `
                -Signature 'fundDripBudget(uint256)' -Arguments @($amountWei)
        }
    }

    $unspent = Read-Contract -Cast $cast -RpcUrl $RpcUrl -Target $vault -Signature 'unspentDripNative()(uint256)'
    $available = Read-Contract -Cast $cast -RpcUrl $RpcUrl -Target $vault -Signature 'availableNative()(uint256)'
    Write-Note ('verified vault.unspentDripNative() = {0}; uncredited availableNative() = {1}' -f $unspent, $available)
    if ([decimal]$unspent -le 0) {
        Write-Warn 'the dripper budget is unfunded, so the dripper cannot pay out until the owner funds it.'
    }
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

    if ($SkipOwnerWiring) {
        Write-Note 'owner-side initialization skipped (-SkipOwnerWiring); the dripper is unusable until the owner wires it'
    } else {
        Write-Note 'owner-side initialization: vault.setDripper, setOwnerSustenanceTarget, fundDripBudget'
        Invoke-OwnerWiring -RpcUrl $rpcUrl -Deployment $deployment
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
