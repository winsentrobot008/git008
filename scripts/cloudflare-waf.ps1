#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Cloudflare WAF rule that blocks admin JSON-RPC on rpc.008ai.online: printed by default, applied with -Apply.

.DESCRIPTION
    The Anvil node behind the `008-video` tunnel answers privileged administration (`anvil_*`, `evm_*`)
    to anyone who can reach the hostname. Two layers close that off, and they are deliberately
    independent:

      1. `scripts/rpc-guard.mjs` - a local reverse proxy in front of the node that refuses the admin
         namespaces by JSON-RPC method name. It is the precise layer, because it understands the
         protocol, but it only protects while it runs.
      2. This rule - a Cloudflare WAF custom rule at the edge that blocks POST bodies containing
         `anvil_` or `evm_` before they reach the tunnel. It survives an origin restart, a redeploy,
         or a guard process someone forgot to start.

    Run it without -Apply and nothing is sent: the script prints the rule expression, the API request
    it would make, and the dashboard path for doing it by hand. -Apply upserts the rule into the zone
    `http_request_firewall_custom` phase entrypoint ruleset.

    Limits worth knowing: a WAF custom rule inspects only the first 128 KB of a request body, and only
    when the body is a type Cloudflare parses. A JSON-RPC call is far smaller than that, but the local
    guard is what makes the restriction exact rather than best-effort, so run both.

    Credentials are read from the environment and are never echoed:
        CLOUDFLARE_API_TOKEN   required with -Apply; needs Zone:Zone:Read and Zone:WAF:Edit
        CLOUDFLARE_ZONE_ID     optional; looked up from -Zone when unset

.PARAMETER Zone
    Zone that owns the hostname.

.PARAMETER Hostname
    Public RPC hostname the rule matches.

.PARAMETER Description
    Rule description, and the key this script upserts and removes by. Change it and you get a second
    rule instead of an update.

.PARAMETER Apply
    Send the change. Without it the script only prints what it would do.

.PARAMETER Remove
    Delete the rule carrying this description instead of writing it.

.PARAMETER DryRun
    Accepted for symmetry with `scripts/cloudflare-dns.ps1`; implies nothing is sent.

.EXAMPLE
    ./scripts/cloudflare-waf.ps1

.EXAMPLE
    $env:CLOUDFLARE_API_TOKEN = "..."
    ./scripts/cloudflare-waf.ps1 -Apply

.EXAMPLE
    ./scripts/cloudflare-waf.ps1 -Remove -Apply
#>
[CmdletBinding()]
param(
    [string]$Zone = "008ai.online",
    [string]$Hostname = "rpc.008ai.online",
    [string]$Description = "MAOTANG: block admin JSON-RPC on rpc.008ai.online",
    [switch]$Apply,
    [switch]$Remove,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$Api = "https://api.cloudflare.com/client/v4"
$Phase = "http_request_firewall_custom"

# Cloudflare expression language. `contains` on the raw body catches the JSON-RPC method name wherever
# it sits in the request, so it also covers a method buried in a batch array.
$Expression = '(http.host eq "{0}" and http.request.method eq "POST" and (http.request.body.raw contains "anvil_" or http.request.body.raw contains "evm_"))' -f $Hostname

$Rule = @{
    description = $Description
    action     = "block"
    enabled    = $true
    expression = $Expression
}

Write-Host "zone        $Zone"
Write-Host "hostname    $Hostname"
Write-Host "phase       $Phase"
Write-Host "expression  $Expression"
Write-Host ""

if (-not $Apply -or $DryRun) {
    Write-Host "DRY RUN - nothing sent." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Dashboard: 008ai.online -> Security -> WAF -> Custom rules -> Create rule"
    Write-Host "  Rule name   $Description"
    Write-Host "  When        Custom filter expression"
    Write-Host "  Expression  $Expression"
    Write-Host "  Then        Block"
    Write-Host ""
    Write-Host "API equivalent (CLOUDFLARE_API_TOKEN needs Zone:Zone:Read + Zone:WAF:Edit):"
    Write-Host "  GET $Api/zones/<zone_id>/rulesets/phases/$Phase/entrypoint"
    Write-Host "  PUT $Api/zones/<zone_id>/rulesets/phases/$Phase/entrypoint"
    Write-Host ("      " + (@{ rules = @($Rule) } | ConvertTo-Json -Depth 12 -Compress))
    Write-Host ""
    Write-Host "Re-run with -Apply to send it."
    return
}

if (-not $env:CLOUDFLARE_API_TOKEN) {
    throw "CLOUDFLARE_API_TOKEN is not set (needs Zone:Zone:Read and Zone:WAF:Edit). Re-run without -Apply to print the rule instead."
}
$Headers = @{ Authorization = "Bearer $($env:CLOUDFLARE_API_TOKEN)" }

function Invoke-Cf {
    param([string]$Method, [string]$Path, [hashtable]$Body, [switch]$AllowNotFound)

    $request = @{ Method = $Method; Uri = "$Api$Path"; Headers = $Headers; ContentType = "application/json" }
    if ($Body) { $request.Body = ($Body | ConvertTo-Json -Depth 12 -Compress) }
    try {
        $response = Invoke-RestMethod @request
    }
    catch {
        $status = 0
        if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
        # A zone that has never had a custom rule has no entrypoint ruleset yet; that is not an error.
        if ($AllowNotFound -and $status -eq 404) { return $null }
        $detail = $_.ErrorDetails.Message
        if (-not $detail -and $_.Exception.Response) {
            $stream = $_.Exception.Response.GetResponseStream()
            if ($stream) { $detail = (New-Object System.IO.StreamReader($stream)).ReadToEnd() }
        }
        throw "Cloudflare API error on $Method $Path - HTTP $status`: $detail"
    }
    if ($response.success -eq $false) {
        $detail = ($response.errors | ForEach-Object { "$($_.code): $($_.message)" }) -join "; "
        throw "Cloudflare API error on $Method $Path - $detail"
    }
    return $response
}

$ZoneId = $env:CLOUDFLARE_ZONE_ID
if (-not $ZoneId) {
    $zone = Invoke-Cf -Method GET -Path "/zones?name=$Zone"
    if (-not $zone.result -or $zone.result.Count -eq 0) { throw "Zone '$Zone' not found for this token." }
    $ZoneId = $zone.result[0].id
    Write-Host "resolved zone id $ZoneId"
}

$EntryPath = "/zones/$ZoneId/rulesets/phases/$Phase/entrypoint"
$current = Invoke-Cf -Method GET -Path $EntryPath -AllowNotFound
$existing = @()
if ($current -and $current.result -and $current.result.rules) { $existing = @($current.result.rules) }
# Upsert by description: the operator's rule replaces itself rather than stacking duplicates.
$kept = @($existing | Where-Object { $_.description -ne $Description })

if ($Remove) {
    if ($kept.Count -eq $existing.Count) { Write-Host "no rule named '$Description' is present; nothing to remove"; return }
    $response = Invoke-Cf -Method PUT -Path $EntryPath -Body @{ rules = $kept }
    Write-Host "OK removed '$Description'; $(@($response.result.rules).Count) rule(s) remain"
    return
}

$merged = @($Rule) + $kept
$response = Invoke-Cf -Method PUT -Path $EntryPath -Body @{ rules = $merged }
Write-Host "OK '$Description' is live: $(@($response.result.rules).Count) rule(s) in $Phase"
