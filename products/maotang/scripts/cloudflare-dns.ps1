#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Idempotent Cloudflare DNS record upsert for the 008 subdomains, plus a zero-credential tunnel route mode.

.DESCRIPTION
    Two modes, both aimed at the MAOTANG subdomains in the `008ai.online` zone:

    1. API mode (default) - creates or updates one DNS record through the Cloudflare API v4.
    2. -Tunnel mode       - delegates to `cloudflared tunnel route dns <tunnel> <hostname>`, which
                            needs no Cloudflare API token at all (it reuses ~/.cloudflared/cert.pem)
                            and writes a proxied CNAME to <tunnel-id>.cfargotunnel.com.

    Records this repo cares about:

        maotang.008ai.online   CNAME   cname.vercel-dns.com             proxied = false   (Vercel custom domain)
        rpc.008ai.online       CNAME   <tunnel-id>.cfargotunnel.com     proxied = true    (cloudflared tunnel route)

    `maotang` must stay DNS-only (grey cloud) because Vercel terminates TLS for
    cname.vercel-dns.com itself, and Vercel cannot verify a proxied record. `rpc` is created by the
    tunnel shortcut instead.

    Credentials are read from the environment and are never echoed:
        CLOUDFLARE_API_TOKEN   required in API mode; needs Zone:DNS:Edit and Zone:Zone:Read
        CLOUDFLARE_ZONE_ID     optional in API mode; looked up from -Zone when unset

.PARAMETER Name
    Record name. A bare label such as "maotang" is qualified with -Zone; a dotted name is used as-is.

.PARAMETER Content
    Record target: a hostname for CNAME/AAAA, an IPv4 address for A. Required unless -Tunnel is used.

.PARAMETER Tunnel
    Name or id of an existing cloudflared tunnel. Switches to the CLI route shortcut.

.PARAMETER Proxied
    $true  = orange cloud (Cloudflare proxy).
    $false = grey cloud / DNS only. Vercel custom domains need $false.

.EXAMPLE
    $env:CLOUDFLARE_API_TOKEN = "..."
    ./scripts/cloudflare-dns.ps1 -Name maotang -Content cname.vercel-dns.com -Proxied:$false

.EXAMPLE
    ./scripts/cloudflare-dns.ps1 -Name rpc -Tunnel 008-video

.EXAMPLE
    ./scripts/cloudflare-dns.ps1 -Name rpc -Tunnel 008-video -DryRun
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Name,
    [string]$Content = "",
    [string]$Zone = "008ai.online",
    [ValidateSet("A", "AAAA", "CNAME")][string]$Type = "CNAME",
    [bool]$Proxied = $false,
    [int]$Ttl = 1,
    [string]$Tunnel = "",
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$Api = "https://api.cloudflare.com/client/v4"

$Fqdn = if ($Name.Contains(".")) { $Name } else { "$Name.$Zone" }

function Resolve-Cloudflared {
    $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    foreach ($candidate in @("$env:ProgramFiles\cloudflared\cloudflared.exe", "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe")) {
        if ($candidate -and (Test-Path $candidate)) { return $candidate }
    }
    return $null
}

# --- Mode 1: zero-credential tunnel route -------------------------------------------------
if ($Tunnel) {
    $cli = Resolve-Cloudflared
    if (-not $cli) { throw "cloudflared not found on PATH or in Program Files; install it first." }
    $cliArgs = @("tunnel", "route", "dns", $Tunnel, $Fqdn)
    Write-Host "TUNNEL $(($cliArgs) -join ' ')"
    if ($DryRun) { Write-Host "dry-run: no change sent"; return }
    & $cli @cliArgs
    if ($LASTEXITCODE -ne 0) { throw "cloudflared tunnel route dns failed (exit code $LASTEXITCODE)" }
    Write-Host "OK route $Fqdn -> tunnel $Tunnel (proxied CNAME to cfargotunnel.com)"
    return
}

# --- Mode 2: API upsert -------------------------------------------------------------------
if (-not $Content) { throw "-Content is required unless -Tunnel is used." }
if (-not $env:CLOUDFLARE_API_TOKEN) {
    throw "CLOUDFLARE_API_TOKEN is not set (needs Zone:DNS:Edit and Zone:Zone:Read). Use -Tunnel for a token-free tunnel route."
}
$Headers = @{ Authorization = "Bearer $($env:CLOUDFLARE_API_TOKEN)" }

function Invoke-Cf {
    param([string]$Method, [string]$Path, [hashtable]$Body)
    $request = @{ Method = $Method; Uri = "$Api$Path"; Headers = $Headers; ContentType = "application/json" }
    if ($Body) { $request.Body = ($Body | ConvertTo-Json -Depth 6 -Compress) }
    try {
        $response = Invoke-RestMethod @request
    }
    catch {
        $detail = $_.ErrorDetails.Message
        if (-not $detail -and $_.Exception.Response) {
            $stream = $_.Exception.Response.GetResponseStream()
            if ($stream) { $detail = (New-Object System.IO.StreamReader($stream)).ReadToEnd() }
        }
        throw "Cloudflare API error on $Method $Path - HTTP $($_.Exception.Response.StatusCode.value__): $detail"
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
}

$existing = (Invoke-Cf -Method GET -Path "/zones/$ZoneId/dns_records?type=$Type&name=$Fqdn").result
$body = @{ type = $Type; name = $Fqdn; content = $Content; proxied = $Proxied; ttl = $Ttl }

if ($existing -and $existing.Count -gt 0) {
    $record = $existing[0]
    Write-Host "UPDATE $($record.type) $($record.name) -> $Content (proxied=$Proxied, id=$($record.id))"
    if ($DryRun) { Write-Host "dry-run: no change sent"; return }
    $result = Invoke-Cf -Method PUT -Path "/zones/$ZoneId/dns_records/$($record.id)" -Body $body
}
else {
    Write-Host "CREATE $Type $Fqdn -> $Content (proxied=$Proxied)"
    if ($DryRun) { Write-Host "dry-run: no change sent"; return }
    $result = Invoke-Cf -Method POST -Path "/zones/$ZoneId/dns_records" -Body $body
}

$rec = $result.result
Write-Host "OK id=$($rec.id) name=$($rec.name) type=$($rec.type) content=$($rec.content) proxied=$($rec.proxied) ttl=$($rec.ttl)"