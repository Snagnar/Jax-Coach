# Jax Coach - local server (Windows PowerShell 5.1, no installs needed)
#  - serves the UI from .\public and the research data from .\data
#  - proxies Riot's official Live Client Data API (https://127.0.0.1:2999, self-signed cert)
#  - proxies the Riot Web API (rank / mastery / match history) with your key from config.json
#  - caches Data Dragon (champion / item data) in .\cache
param([int]$Port = 0)

$ErrorActionPreference = 'Stop'
$Root     = Split-Path -Parent $MyInvocation.MyCommand.Path
$Public   = Join-Path $Root 'public'
$DataDir  = Join-Path $Root 'data'
$CacheDir = Join-Path $Root 'cache'
$ConfigPath = Join-Path $Root 'config.json'
$RiotDiskCache = Join-Path $CacheDir 'matches'        # before 1.1: finished matches were cached here (moved to the archive)
$HistoryDir = Join-Path $Root 'history'
$ArchiveDir = Join-Path $HistoryDir 'matches'         # your match archive: every game Riot still had, gzipped, kept for good
$GamesDir   = Join-Path $HistoryDir 'games'           # one summary row per archived game (written by the page)
$TtsCache = Join-Path $CacheDir 'tts'
$ShippedPb = Join-Path $DataDir 'champions'          # playbooks that ship with the app (in git)
$LocalPb   = Join-Path $Root 'playbooks'             # playbooks made or changed on this PC (research agents, your approvals)
$JobsDir   = Join-Path $Root 'jobs'                  # research agent runs
$AgentsDir = Join-Path $Root 'agents'                # agent prompts and the playbook format
New-Item -ItemType Directory -Force $CacheDir, $HistoryDir, $ArchiveDir, $GamesDir, $TtsCache, $LocalPb, $JobsDir | Out-Null

Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Net;
using System.Net.Security;
using System.Security.Cryptography.X509Certificates;
using System.Text;

public class JcResult { public int Status; public string Body; public string RetryAfter; }
public class JcBin { public int Status; public byte[] Data; public string Error; }

public static class JcHttp {
    public static void Install() {
        ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
        ServicePointManager.ServerCertificateValidationCallback = Validate;
        ServicePointManager.DefaultConnectionLimit = 8;
    }
    // Only the local game (127.0.0.1:2999) and League client (127.0.0.1, random port) may use self-signed certificates.
    static bool Validate(object sender, X509Certificate cert, X509Chain chain, SslPolicyErrors errors) {
        if (errors == SslPolicyErrors.None) return true;
        HttpWebRequest req = sender as HttpWebRequest;
        return req != null && req.RequestUri.Host == "127.0.0.1";
    }
    public static JcResult Get(string url, string riotToken, int timeoutMs) { return Get(url, riotToken, timeoutMs, null); }
    public static JcResult Get(string url, string riotToken, int timeoutMs, string authorization) {
        HttpWebRequest req = (HttpWebRequest)WebRequest.Create(url);
        req.Timeout = timeoutMs; req.ReadWriteTimeout = timeoutMs;
        req.AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate;
        req.UserAgent = "JaxCoach/1.0";
        if (!String.IsNullOrEmpty(riotToken)) req.Headers.Add("X-Riot-Token", riotToken);
        if (!String.IsNullOrEmpty(authorization)) req.Headers.Add("Authorization", authorization);
        try {
            using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse()) return Read(resp);
        } catch (WebException ex) {
            HttpWebResponse r = ex.Response as HttpWebResponse;
            if (r != null) { using (r) return Read(r); }
            JcResult f = new JcResult(); f.Status = 0; f.Body = ex.Message; return f;
        }
    }
    // POST a JSON body with a Bearer token and return the raw response bytes (used for text-to-speech audio)
    public static JcBin PostJson(string url, string bearer, string json, int timeoutMs) { return Send("POST", url, "Bearer " + bearer, json, timeoutMs); }
    // any method with a JSON body; authorization is the full header value (or null)
    public static JcBin Send(string method, string url, string authorization, string json, int timeoutMs) {
        HttpWebRequest req = (HttpWebRequest)WebRequest.Create(url);
        req.Method = method; req.ContentType = "application/json";
        req.Timeout = timeoutMs; req.ReadWriteTimeout = timeoutMs;
        req.UserAgent = "JaxCoach/1.0";
        if (!String.IsNullOrEmpty(authorization)) req.Headers.Add("Authorization", authorization);
        byte[] payload = Encoding.UTF8.GetBytes(json);
        JcBin res = new JcBin();
        try {
            using (Stream s = req.GetRequestStream()) s.Write(payload, 0, payload.Length);
            using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse()) { res.Status = (int)resp.StatusCode; res.Data = ReadAll(resp.GetResponseStream()); }
        } catch (WebException ex) {
            HttpWebResponse r = ex.Response as HttpWebResponse;
            if (r != null) { using (r) { res.Status = (int)r.StatusCode; res.Error = Encoding.UTF8.GetString(ReadAll(r.GetResponseStream())); } }
            else { res.Status = 0; res.Error = ex.Message; }
        }
        return res;
    }
    static byte[] ReadAll(Stream s) { using (MemoryStream ms = new MemoryStream()) { s.CopyTo(ms); return ms.ToArray(); } }
    static JcResult Read(HttpWebResponse resp) {
        JcResult res = new JcResult();
        res.Status = (int)resp.StatusCode;
        res.RetryAfter = resp.Headers["Retry-After"];
        using (StreamReader sr = new StreamReader(resp.GetResponseStream(), Encoding.UTF8)) res.Body = sr.ReadToEnd();
        return res;
    }
}

// the match archive stores Riot's JSON gzipped (about a tenth of the size)
public static class JcGz {
    public static void Write(string path, string text) {
        string tmp = path + ".tmp";
        using (FileStream fs = File.Create(tmp))
        using (System.IO.Compression.GZipStream gz = new System.IO.Compression.GZipStream(fs, System.IO.Compression.CompressionLevel.Optimal)) {
            byte[] b = new UTF8Encoding(false).GetBytes(text); gz.Write(b, 0, b.Length);
        }
        if (File.Exists(path)) File.Delete(path);
        File.Move(tmp, path);
    }
    public static string Read(string path) {
        using (FileStream fs = File.OpenRead(path))
        using (System.IO.Compression.GZipStream gz = new System.IO.Compression.GZipStream(fs, System.IO.Compression.CompressionMode.Decompress))
        using (StreamReader sr = new StreamReader(gz, Encoding.UTF8)) return sr.ReadToEnd();
    }
}
"@
[JcHttp]::Install()

# ---------------- config ----------------
$PlatformRouting = @{
  euw1='europe'; eun1='europe'; tr1='europe'; ru='europe'; me1='europe'
  na1='americas'; br1='americas'; la1='americas'; la2='americas'
  kr='asia'; jp1='asia'
  oc1='sea'; sg2='sea'; tw2='sea'; vn2='sea'
}
function Load-Config {
  $cfg = [ordered]@{ riotApiKey = ''; platform = 'euw1'; port = 8787 }
  if (Test-Path $ConfigPath) {
    try {
      $j = Get-Content $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
      foreach ($p in $j.PSObject.Properties) { $cfg[$p.Name] = $p.Value }
    } catch { Write-Host "config.json could not be read: $_" -ForegroundColor Yellow }
  }
  return $cfg
}
function Save-Config($cfg) {
  $json = $cfg | ConvertTo-Json
  [IO.File]::WriteAllText($ConfigPath, $json, (New-Object Text.UTF8Encoding($false)))
}
$Config = Load-Config
if (-not (Test-Path $ConfigPath)) { Save-Config $Config }

# Keys in a .env file (next to the app, or in your user folder) win over config.json, so a fresh
# daily dev key only has to be pasted in one place. Any value starting with RGAPI- is the Riot key,
# any value starting with gsk_ is a Groq key (text-to-speech).
$script:KeySource = if ($Config.riotApiKey) { 'config.json' } else { '' }
$script:GroqKey = ''
# (.env.txt too: Notepad likes to append .txt)
foreach ($envFile in @((Join-Path $Root '.env'), (Join-Path $HOME '.env'), (Join-Path $HOME '.env.txt'))) {
  if (-not (Test-Path $envFile)) { continue }
  foreach ($line in [IO.File]::ReadAllLines($envFile)) {
    if ($script:KeySource -notlike '*.env*' -and $line -match '^\s*(?:export\s+)?[A-Za-z0-9_]+\s*=\s*["'']?(RGAPI-[A-Za-z0-9-]+)') {
      $Config.riotApiKey = $Matches[1]; $script:KeySource = $envFile
    }
    if (-not $script:GroqKey -and $line -match '^\s*(?:export\s+)?[A-Za-z0-9_]+\s*=\s*["'']?(gsk_[A-Za-z0-9]+)') { $script:GroqKey = $Matches[1] }
  }
}
if ($Port -eq 0) { $Port = [int]$Config.port }

function Get-Hosts {
  $plat = "$($Config.platform)".ToLower()
  $match = $PlatformRouting[$plat]; if (-not $match) { $match = 'europe' }
  $account = if ($match -eq 'sea') { 'asia' } else { $match }
  return @{ platform = "$plat.api.riotgames.com"; match = "$match.api.riotgames.com"; account = "$account.api.riotgames.com" }
}

# ---------------- response helpers ----------------
$Mime = @{ '.html'='text/html'; '.js'='application/javascript'; '.css'='text/css'; '.json'='application/json';
           '.png'='image/png'; '.svg'='image/svg+xml'; '.ico'='image/x-icon'; '.webp'='image/webp' }

function Send($ctx, [int]$status, [string]$body, [string]$type = 'application/json') {
  $bytes = [Text.Encoding]::UTF8.GetBytes($body)
  $res = $ctx.Response
  $res.StatusCode = $status
  $res.ContentType = "$type; charset=utf-8"
  $res.Headers['Cache-Control'] = 'no-store'
  $res.ContentLength64 = $bytes.Length
  if ($ctx.Request.HttpMethod -ne 'HEAD') { $res.OutputStream.Write($bytes, 0, $bytes.Length) }
  $res.OutputStream.Close()
}
function Send-File($ctx, [string]$baseDir, [string]$relPath) {
  $full = [IO.Path]::GetFullPath((Join-Path $baseDir $relPath))
  if (-not $full.StartsWith([IO.Path]::GetFullPath($baseDir)) -or -not (Test-Path $full -PathType Leaf)) {
    Send $ctx 404 '{"error":"not_found"}'; return
  }
  $ext = [IO.Path]::GetExtension($full).ToLower()
  $type = $Mime[$ext]; if (-not $type) { $type = 'application/octet-stream' }
  $bytes = [IO.File]::ReadAllBytes($full)
  $res = $ctx.Response
  $res.StatusCode = 200
  $res.ContentType = if ($type -like 'image/*') { $type } else { "$type; charset=utf-8" }
  $res.Headers['Cache-Control'] = 'no-store'
  $res.ContentLength64 = $bytes.Length
  if ($ctx.Request.HttpMethod -ne 'HEAD') { $res.OutputStream.Write($bytes, 0, $bytes.Length) }
  $res.OutputStream.Close()
}
function Json-Escape([string]$s) { return ($s | ConvertTo-Json) }

# ---------------- Data Dragon cache ----------------
function Get-DDVersion {
  $vfile = Join-Path $CacheDir 'versions.json'
  $fresh = (Test-Path $vfile) -and ((Get-Item $vfile).LastWriteTime -gt (Get-Date).AddHours(-6))
  if (-not $fresh) {
    $r = [JcHttp]::Get('https://ddragon.leagueoflegends.com/api/versions.json', $null, 8000)
    if ($r.Status -eq 200) { [IO.File]::WriteAllText($vfile, $r.Body) }
  }
  if (-not (Test-Path $vfile)) { return $null }
  return (Get-Content $vfile -Raw | ConvertFrom-Json)[0]
}
function Get-DDFile([string]$kind) {
  $ver = Get-DDVersion
  if (-not $ver) { return $null }
  $file = Join-Path $CacheDir "$kind-$ver.json"
  if (-not (Test-Path $file)) {
    $r = [JcHttp]::Get("https://ddragon.leagueoflegends.com/cdn/$ver/data/en_US/$kind.json", $null, 15000)
    if ($r.Status -ne 200) { return $null }
    [IO.File]::WriteAllText($file, $r.Body, (New-Object Text.UTF8Encoding($false)))
  }
  return [IO.File]::ReadAllText($file, [Text.Encoding]::UTF8)
}

# ---------------- match archive ----------------
# Finished matches and timelines never change: every one the app downloads is kept (gzipped) in history\matches,
# so your history outlives Riot's (about two years) and clearing the caches never loses it.
function Get-ArchivePath([string]$id, [bool]$timeline) { Join-Path $ArchiveDir ($id + $(if ($timeline) { '_timeline' } else { '' }) + '.json.gz') }
function Read-Archived([string]$path) {
  if (Test-Path $path) { try { return [JcGz]::Read($path) } catch { Remove-Item $path -Force -ErrorAction SilentlyContinue } }
  return $null
}
# one-time move of the old match cache (cache\matches\*.json) into the archive
function Move-OldMatchCache {
  if (-not (Test-Path $RiotDiskCache)) { return }
  foreach ($f in (Get-ChildItem $RiotDiskCache -Filter '*.json' -File -ErrorAction SilentlyContinue)) {
    $dest = Join-Path $ArchiveDir ($f.BaseName + '.json.gz')
    try { if (-not (Test-Path $dest)) { [JcGz]::Write($dest, [IO.File]::ReadAllText($f.FullName, [Text.Encoding]::UTF8)) }; Remove-Item $f.FullName -Force } catch {}
  }
  if (-not (Get-ChildItem $RiotDiskCache -Force -ErrorAction SilentlyContinue)) { Remove-Item $RiotDiskCache -Force -ErrorAction SilentlyContinue }
}
Move-OldMatchCache

# /api/archive          GET: what's archived { meta, matches: [ids], timelines: [ids] }
# /api/archive/rows     GET: every summary row (one JSON file per game)
# /api/archive/rows/ID  POST: save one row (the page builds them from the match data)
# /api/archive/meta     POST: the importer's progress (which queues are fully imported, for whom)
function Handle-Archive($ctx, [string]$sub) {
  $req = $ctx.Request
  $metaFile = Join-Path $HistoryDir 'archive.json'
  if ($req.HttpMethod -eq 'POST') {
    $body = (New-Object IO.StreamReader($req.InputStream, [Text.Encoding]::UTF8)).ReadToEnd()
    try { $null = $body | ConvertFrom-Json } catch { Send $ctx 400 '{"error":"bad_json"}'; return }
    if ($sub -match '^/rows/([A-Z0-9]+_\d+)$') { [IO.File]::WriteAllText((Join-Path $GamesDir ($Matches[1] + '.json')), $body, (New-Object Text.UTF8Encoding($false))); Send $ctx 200 '{"ok":true}'; return }
    if ($sub -eq '/meta') { [IO.File]::WriteAllText($metaFile, $body, (New-Object Text.UTF8Encoding($false))); Send $ctx 200 '{"ok":true}'; return }
    Send $ctx 404 '{"error":"not_found"}'; return
  }
  if ($sub -eq '/rows') {
    $rows = foreach ($f in (Get-ChildItem $GamesDir -Filter '*.json' -File -ErrorAction SilentlyContinue)) { [IO.File]::ReadAllText($f.FullName, [Text.Encoding]::UTF8) }
    Send $ctx 200 ('[' + (@($rows) -join ',') + ']'); return
  }
  $m = New-Object Collections.Generic.List[string]; $t = New-Object Collections.Generic.List[string]
  foreach ($f in (Get-ChildItem $ArchiveDir -Filter '*.json.gz' -File -ErrorAction SilentlyContinue)) {
    $n = $f.Name.Substring(0, $f.Name.Length - 8)
    if ($n.EndsWith('_timeline')) { $t.Add($n.Substring(0, $n.Length - 9)) } else { $m.Add($n) }
  }
  $meta = if (Test-Path $metaFile) { [IO.File]::ReadAllText($metaFile, [Text.Encoding]::UTF8) } else { '{}' }
  Send $ctx 200 ('{"meta":' + $meta + ',"matches":' + (ConvertTo-Json @($m) -Compress) + ',"timelines":' + (ConvertTo-Json @($t) -Compress) + '}')
}

# ---------------- Riot API proxy ----------------
$RiotCache = @{}
$script:LastRiotCall = [DateTime]::MinValue
$AllowedRiot = '^/(riot/account/v1|lol/league/v4|lol/champion-mastery/v4|lol/match/v5|lol/summoner/v4)/'

function Handle-Riot($ctx, [string]$route, [string]$pathAndQuery) {
  if (-not $Config.riotApiKey) { Send $ctx 401 '{"error":"no_api_key"}'; return }
  if ($pathAndQuery -notmatch $AllowedRiot) { Send $ctx 403 '{"error":"path_not_allowed"}'; return }
  $hosts = Get-Hosts
  $apiHost = $hosts[$route]
  if (-not $apiHost) { Send $ctx 400 '{"error":"bad_route"}'; return }
  # "jcfresh=1" (ours, not Riot's) skips the 10-minute cache, e.g. to see a game that just ended
  $fresh = $pathAndQuery -match '[?&]jcfresh=1'
  $pathAndQuery = $pathAndQuery -replace '[?&]jcfresh=1$', '' -replace 'jcfresh=1&', ''
  $url = "https://$apiHost$pathAndQuery"

  # finished matches and their timelines never change: keep them on disk
  $diskFile = $null
  if ($pathAndQuery -match '^/lol/match/v5/matches/([A-Z0-9]+_\d+)(/timeline)?$') {
    $diskFile = Get-ArchivePath $Matches[1] ([bool]$Matches[2])
    $text = Read-Archived $diskFile
    if ($null -ne $text) { $ctx.Response.Headers['X-JC-Archive'] = '1'; Send $ctx 200 $text; return }
  }
  $isMatchDetail = [bool]$diskFile
  $hit = $RiotCache[$url]
  if ($hit -and ($isMatchDetail -or (-not $fresh -and ((Get-Date) - $hit.t).TotalMinutes -lt 10))) {
    Send $ctx $hit.status $hit.body; return
  }
  # stay well under the dev-key limit of 20 requests / second
  $wait = 60 - ((Get-Date) - $script:LastRiotCall).TotalMilliseconds
  if ($wait -gt 0) { Start-Sleep -Milliseconds ([int]$wait) }
  $r = [JcHttp]::Get($url, $Config.riotApiKey, 8000)
  $script:LastRiotCall = Get-Date
  if ($r.Status -eq 200 -or $r.Status -eq 404) { $RiotCache[$url] = @{ t = Get-Date; status = $r.Status; body = $r.Body } }
  if ($r.Status -eq 200 -and $diskFile) { try { [JcGz]::Write($diskFile, $r.Body) } catch {} }
  if ($r.Status -eq 429 -and $r.RetryAfter) { $ctx.Response.Headers['Retry-After'] = $r.RetryAfter }
  $status = if ($r.Status -eq 0) { 502 } else { $r.Status }
  $body = if ($r.Body) { $r.Body } else { '{}' }
  Send $ctx $status $body
}

# ---------------- League client (champ select) ----------------
# The League client exposes a local API; port and auth token come from its process command line
# (or its lockfile). Only a few read-only endpoints are allowed.
$script:Lcu = $null
$script:LcuCheckedAt = [DateTime]::MinValue
$AllowedLcu = '^/(lol-gameflow/v1/gameflow-phase|lol-champ-select/v1/session|lol-summoner/v1/current-summoner|lol-replays/v1/metadata/\d+|lol-replays/v1/configuration)$'
# the only client actions this app may trigger, and only on a click: download / open the replay of one of your games
$AllowedLcuPost = '^/lol-replays/v1/rofls/\d+/(download|watch)$'

function Get-Lcu {
  if ($script:Lcu) { return $script:Lcu }
  if (((Get-Date) - $script:LcuCheckedAt).TotalSeconds -lt 8) { return $null }
  $script:LcuCheckedAt = Get-Date
  if (-not (Get-Process -Name 'LeagueClientUx' -ErrorAction SilentlyContinue)) { return $null }
  $p = Get-CimInstance Win32_Process -Filter "Name='LeagueClientUx.exe'" -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $p) { return $null }
  if ($p.ExecutablePath) { $script:LeagueDir = Split-Path $p.ExecutablePath }
  $port = $null; $token = $null
  if ($p.CommandLine -match '--app-port=(\d+)') { $port = $Matches[1] }
  if ($p.CommandLine -match '--remoting-auth-token=([\w-]+)') { $token = $Matches[1] }
  if ((-not $port -or -not $token) -and $p.ExecutablePath) {
    $lock = Join-Path (Split-Path $p.ExecutablePath) 'lockfile'
    if (Test-Path $lock) {
      try {
        $fs = [IO.File]::Open($lock, 'Open', 'Read', 'ReadWrite')
        $parts = (New-Object IO.StreamReader($fs)).ReadToEnd().Split(':'); $fs.Close()
        $port = $parts[2]; $token = $parts[3]
      } catch {}
    }
  }
  if (-not $port -or -not $token) { return $null }
  $script:Lcu = @{ port = $port; auth = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("riot:$token")) }
  return $script:Lcu
}
function Handle-Lcu($ctx, [string]$path) {
  $isPost = $ctx.Request.HttpMethod -eq 'POST'
  if (($isPost -and $path -notmatch $AllowedLcuPost) -or (-not $isPost -and $path -notmatch $AllowedLcu)) { Send $ctx 403 '{"error":"path_not_allowed"}'; return }
  $lcu = Get-Lcu
  if (-not $lcu) { Send $ctx 503 '{"error":"client_not_running"}'; return }
  if ($isPost) {
    # fixed body: the same thing the client's own replay button sends
    $p = [JcHttp]::Send('POST', "https://127.0.0.1:$($lcu.port)$path", $lcu.auth, '{"componentType":"replay-button_match-history"}', 5000)
    if ($p.Status -eq 0) { $script:Lcu = $null; Send $ctx 503 '{"error":"client_not_running"}'; return }
    $b = if ($p.Data) { [Text.Encoding]::UTF8.GetString($p.Data) } elseif ($p.Error) { $p.Error } else { '' }
    if (-not $b) { $b = '{}' }
    Send $ctx $p.Status $b; return
  }
  $r = [JcHttp]::Get("https://127.0.0.1:$($lcu.port)$path", $null, 2000, $lcu.auth)
  if ($r.Status -eq 0 -or $r.Status -eq 401) { $script:Lcu = $null; Send $ctx 503 '{"error":"client_not_running"}'; return }
  $body = if ($r.Body) { $r.Body } else { '{}' }
  Send $ctx $r.Status $body
}

# ---------------- loadout: set the rune page, summoner spells and item set in the client (champ select) ----------------
# Only on your click. Writes exactly three things: a rune page named "Jax Coach" (made once; if all your pages are
# full it replaces the page you have selected that one time), your two summoner spells, and an item set named
# "Jax Coach". Nothing else in the client is touched.
$LoadoutName = 'Jax Coach'
function Lcu-Call($lcu, [string]$method, [string]$path, [string]$body) {
  $url = "https://127.0.0.1:$($lcu.port)$path"
  if ($method -eq 'GET') { $r = [JcHttp]::Get($url, $null, 6000, $lcu.auth); return @{ status = $r.Status; body = $r.Body } }
  $r = [JcHttp]::Send($method, $url, $lcu.auth, $(if ($body) { $body } else { '' }), 12000)
  $b = if ($r.Data) { [Text.Encoding]::UTF8.GetString($r.Data) } else { "$($r.Error)" }
  # every write and its answer goes to logs\server.log, so a failure can be traced
  $short = if ($b.Length -gt 300) { $b.Substring(0, 300) } else { $b }
  Write-Host "Loadout: $method $path -> $($r.Status) $short"
  return @{ status = $r.Status; body = $b }
}
function Lcu-Error($r) {
  try { $o = $r.body | ConvertFrom-Json; if ($o.message) { return "$($o.message)" } } catch {}
  if ($r.status -eq 0) { return 'the League client did not answer' }
  return "HTTP $($r.status)"
}
function Get-OwnPage($lcu) {
  $r = Lcu-Call $lcu 'GET' '/lol-perks/v1/pages' $null
  if ($r.status -ne 200) { return @{ ok = $false; err = Lcu-Error $r } }
  $pages = @($r.body | ConvertFrom-Json)
  return @{ ok = $true; pages = $pages; own = @($pages | Where-Object { $_.name -eq $LoadoutName -and $_.isDeletable }) }
}
function Set-LoadoutRunes($lcu, $page) {
  $ids = @($page.selectedPerkIds | ForEach-Object { [int]$_ })
  if ($ids.Count -ne 9 -or -not $page.primaryStyleId -or -not $page.subStyleId) { return @{ ok = $false; msg = 'incomplete rune page' } }
  $st = Get-OwnPage $lcu
  if (-not $st.ok) { return @{ ok = $false; msg = "couldn't read your rune pages ($($st.err))" } }
  $body = [ordered]@{ name = $LoadoutName; primaryStyleId = [int]$page.primaryStyleId; subStyleId = [int]$page.subStyleId; selectedPerkIds = $ids; current = $true }
  $json = $body | ConvertTo-Json -Compress
  $note = ''
  if ($st.own.Count) {
    # our page exists: edit it in place (no slot is freed or taken)
    $id = [long]$st.own[0].id
    $p = Lcu-Call $lcu 'PUT' "/lol-perks/v1/pages/$id" $json
    if ($p.status -ge 200 -and $p.status -lt 300) {
      $null = Lcu-Call $lcu 'PUT' '/lol-perks/v1/currentpage' "$id"
      return @{ ok = $true; msg = "rune page '$LoadoutName' updated" }
    }
    # editing refused: replace our own page (and only ours)
    $d = Lcu-Call $lcu 'DELETE' "/lol-perks/v1/pages/$id" $null
    if ($d.status -ge 300 -or $d.status -eq 0) { return @{ ok = $false; msg = "the client refused the page: $(Lcu-Error $p)" } }
  } else {
    # no page of ours yet: only when every slot is used, the selected page makes room (once)
    $inv = Lcu-Call $lcu 'GET' '/lol-perks/v1/inventory' $null
    $full = $false
    try { $o = $inv.body | ConvertFrom-Json; $full = ($o.canAddCustomPage -eq $false) } catch {}
    if ($full) {
      $c = Lcu-Call $lcu 'GET' '/lol-perks/v1/currentpage' $null
      $cur = $null; try { $cur = $c.body | ConvertFrom-Json } catch {}
      if (-not $cur -or -not $cur.isDeletable) { $cur = @($st.pages | Where-Object { $_.isDeletable })[0] }
      if (-not $cur) { return @{ ok = $false; msg = 'all rune pages are in use and none can be replaced' } }
      $d = Lcu-Call $lcu 'DELETE' "/lol-perks/v1/pages/$([long]$cur.id)" $null
      if ($d.status -ge 300 -or $d.status -eq 0) { return @{ ok = $false; msg = "couldn't make room for the page ($(Lcu-Error $d))" } }
      $note = " (all slots were used: replaced your page '$($cur.name)')"
    }
  }
  $p = Lcu-Call $lcu 'POST' '/lol-perks/v1/pages' $json
  if ($p.status -ge 200 -and $p.status -lt 300) { return @{ ok = $true; msg = "rune page '$LoadoutName' set$note" } }
  # a slow client may have saved it anyway
  $again = Get-OwnPage $lcu
  if ($again.ok -and $again.own.Count) { return @{ ok = $true; msg = "rune page '$LoadoutName' set$note" } }
  return @{ ok = $false; msg = "the client refused the page: $(Lcu-Error $p)" }
}
function Set-LoadoutSpells($lcu, $spells) {
  $a = [int]$spells.spell1Id; $b = [int]$spells.spell2Id
  if ($a -le 0 -or $b -le 0 -or $a -eq $b) { return @{ ok = $false; msg = 'invalid summoner spells' } }
  $r = Lcu-Call $lcu 'PATCH' '/lol-champ-select/v1/session/my-selection' ('{"spell1Id":' + $a + ',"spell2Id":' + $b + '}')
  if ($r.status -ge 400 -or $r.status -eq 0) { return @{ ok = $false; msg = "couldn't set summoner spells ($(Lcu-Error $r))" } }
  return @{ ok = $true; msg = 'summoner spells set' }
}
function Set-LoadoutItems($lcu, $set) {
  $me = Lcu-Call $lcu 'GET' '/lol-summoner/v1/current-summoner' $null
  if ($me.status -ne 200) { return @{ ok = $false; msg = "couldn't read your account ($(Lcu-Error $me))" } }
  $sid = [long](($me.body | ConvertFrom-Json).summonerId)
  $r = Lcu-Call $lcu 'GET' "/lol-item-sets/v1/item-sets/$sid/sets" $null
  if ($r.status -ne 200) { return @{ ok = $false; msg = "couldn't read your item sets ($(Lcu-Error $r))" } }
  $all = $r.body | ConvertFrom-Json
  $blocks = @(foreach ($bl in @($set.blocks)) {
    $items = @(foreach ($it in @($bl.items)) { if ("$($it.id)" -match '^\d{1,6}$') { [ordered]@{ id = "$($it.id)"; count = [Math]::Max(1, [Math]::Min(9, [int]$it.count)) } } })
    if ($items.Count) { [ordered]@{ type = "$($bl.type)"; items = $items } }
  })
  $champs = @($set.associatedChampions | ForEach-Object { [int]$_ } | Where-Object { $_ -gt 0 })
  $new = [ordered]@{ title = $LoadoutName; type = 'custom'; map = 'any'; mode = 'any'; sortrank = 0; startedFrom = 'blank'
    associatedChampions = $champs; associatedMaps = @(11); blocks = $blocks; preferredItemSlots = @(); uid = [guid]::NewGuid().ToString() }
  $all.itemSets = @(@($all.itemSets) | Where-Object { $_ -and $_.title -ne $LoadoutName }) + @([pscustomobject]$new)
  $put = Lcu-Call $lcu 'PUT' "/lol-item-sets/v1/item-sets/$sid/sets" ($all | ConvertTo-Json -Depth 12 -Compress)
  if ($put.status -ge 400 -or $put.status -eq 0) { return @{ ok = $false; msg = "couldn't save the item set ($(Lcu-Error $put))" } }
  return @{ ok = $true; msg = "item set '$LoadoutName' saved" }
}
function Handle-LoadoutApply($ctx) {
  if ($ctx.Request.HttpMethod -ne 'POST') { Send $ctx 405 '{"error":"post_only"}'; return }
  $lcu = Get-Lcu
  if (-not $lcu) { Send $ctx 503 '{"error":"client_not_running"}'; return }
  try { $in = (Read-Body $ctx) | ConvertFrom-Json } catch { Send $ctx 400 '{"error":"bad_json"}'; return }
  $out = [ordered]@{}
  foreach ($part in @('runes', 'spells', 'items')) {
    $v = $in.$part
    if (-not $v) { continue }
    try {
      $res = switch ($part) { 'runes' { Set-LoadoutRunes $lcu $v } 'spells' { Set-LoadoutSpells $lcu $v } 'items' { Set-LoadoutItems $lcu $v } }
    } catch { $res = @{ ok = $false; msg = "$($_.Exception.Message)" } }
    $out[$part] = $res
  }
  Send $ctx 200 ($out | ConvertTo-Json -Depth 4 -Compress)
}

# ---------------- text-to-speech via Groq (Orpheus), cached on disk ----------------
$TtsVoices = @('autumn', 'diana', 'hannah', 'austin', 'daniel', 'troy')
$script:GroqCalls = @()
function Handle-Tts($ctx) {
  $req = $ctx.Request
  if ($req.HttpMethod -ne 'POST') { Send $ctx 405 '{"error":"post_only"}'; return }
  if (-not $script:GroqKey) { Send $ctx 401 '{"error":"no_groq_key"}'; return }
  $in = (New-Object IO.StreamReader($req.InputStream, [Text.Encoding]::UTF8)).ReadToEnd() | ConvertFrom-Json
  $voice = "$($in.voice)".ToLower(); if ($TtsVoices -notcontains $voice) { $voice = 'hannah' }
  $style = "$($in.style)" -replace '[^A-Za-z ]', ''
  $text = "$($in.text)".Trim()
  $ttsInput = if ($style) { "[$style] $text" } else { $text }
  if (-not $text -or $ttsInput.Length -gt 200) { Send $ctx 400 '{"error":"text_empty_or_over_200_chars"}'; return }

  $sha = [Security.Cryptography.SHA1]::Create()
  $hash = -join ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes("$voice|$ttsInput")) | ForEach-Object { $_.ToString('x2') })
  $file = Join-Path $TtsCache "$hash.wav"
  if (-not (Test-Path $file)) {
    # free tier: 10 requests/minute, 100/day. Stay just under and let the page use the local voice instead.
    $now = Get-Date
    $script:GroqCalls = @($script:GroqCalls | Where-Object { ($now - $_).TotalHours -lt 24 })
    if (@($script:GroqCalls | Where-Object { ($now - $_).TotalSeconds -lt 60 }).Count -ge 9) { Send $ctx 429 '{"error":"groq_minute_limit"}'; return }
    if ($script:GroqCalls.Count -ge 95) { Send $ctx 429 '{"error":"groq_daily_limit"}'; return }
    $script:GroqCalls += $now
    $body = @{ model = 'canopylabs/orpheus-v1-english'; voice = $voice; input = $ttsInput; response_format = 'wav' } | ConvertTo-Json -Compress
    $r = [JcHttp]::PostJson('https://api.groq.com/openai/v1/audio/speech', $script:GroqKey, $body, 15000)
    if ($r.Status -ne 200) {
      Write-Host "Groq TTS error $($r.Status): $($r.Error)" -ForegroundColor Yellow
      $status = if ($r.Status -eq 0) { 502 } else { $r.Status }
      $msg = "$($r.Error)"
      if ($msg -match '"message"\s*:\s*"((?:[^"\\]|\\.)*)"') { $msg = $Matches[1] -replace '\\/', '/' }
      Send $ctx $status ('{"error":' + (Json-Escape $msg) + '}'); return
    }
    [IO.File]::WriteAllBytes($file, $r.Data)
  }
  $bytes = [IO.File]::ReadAllBytes($file)
  $res = $ctx.Response
  $res.StatusCode = 200; $res.ContentType = 'audio/wav'; $res.ContentLength64 = $bytes.Length
  $res.OutputStream.Write($bytes, 0, $bytes.Length); $res.OutputStream.Close()
}

# ---------------- game history (written by the page after each game) ----------------
function Handle-History($ctx) {
  $req = $ctx.Request
  if ($req.HttpMethod -eq 'POST') {
    $body = (New-Object IO.StreamReader($req.InputStream, [Text.Encoding]::UTF8)).ReadToEnd()
    try { $null = $body | ConvertFrom-Json } catch { Send $ctx 400 '{"error":"bad_json"}'; return }
    $name = 'game-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json'
    [IO.File]::WriteAllText((Join-Path $HistoryDir $name), $body, (New-Object Text.UTF8Encoding($false)))
    Send $ctx 200 ('{"saved":' + (Json-Escape $name) + '}'); return
  }
  $items = Get-ChildItem $HistoryDir -Filter 'game-*.json' | Sort-Object Name | ForEach-Object { [IO.File]::ReadAllText($_.FullName, [Text.Encoding]::UTF8) }
  Send $ctx 200 ('[' + ($items -join ',') + ']')
}

# ---------------- replay: jump to a moment (League's Replay API, needs EnableReplayApi=1 in game.cfg) ----------------
function Handle-Replay($ctx) {
  if (-not (Get-Process -Name 'League of Legends' -ErrorAction SilentlyContinue)) { Send $ctx 503 '{"error":"replay_not_running"}'; return }
  $url = 'https://127.0.0.1:2999/replay/playback'
  if ($ctx.Request.HttpMethod -eq 'POST') {
    $in = (New-Object IO.StreamReader($ctx.Request.InputStream, [Text.Encoding]::UTF8)).ReadToEnd() | ConvertFrom-Json
    $out = [ordered]@{}
    if ($null -ne $in.time) { $out.time = [double]$in.time }
    if ($null -ne $in.paused) { $out.paused = [bool]$in.paused }
    if ($null -ne $in.speed) { $out.speed = [Math]::Min(8, [Math]::Max(0.25, [double]$in.speed)) }
    $p = [JcHttp]::Send('POST', $url, $null, ($out | ConvertTo-Json -Compress), 3000)
    if ($p.Status -eq 0) { Send $ctx 503 '{"error":"replay_api_off"}'; return }
    $b = if ($p.Data) { [Text.Encoding]::UTF8.GetString($p.Data) } else { '{}' }
    Send $ctx $p.Status $b; return
  }
  $r = [JcHttp]::Get($url, $null, 2000)
  if ($r.Status -eq 0) { Send $ctx 503 '{"error":"replay_api_off"}'; return }
  Send $ctx $r.Status $(if ($r.Body) { $r.Body } else { '{}' })
}

# ---------------- champion playbooks + research agents ----------------
. (Join-Path $AgentsDir 'runner.ps1')

# ---------------- storage: what Jax Coach keeps on disk (Settings shows it; caches can be cleared) ----------------
$script:VoiceEngineSize = $null
function Get-FilesSize($files) { $m = @($files) | Measure-Object Length -Sum; return @{ bytes = [int64]$m.Sum; files = [int]$m.Count } }
function Get-TreeFiles([string]$dir) { if (Test-Path $dir) { Get-ChildItem $dir -Recurse -File -Force -ErrorAction SilentlyContinue } }
function Get-FinishedJobDirs {
  Get-ChildItem $JobsDir -Directory -ErrorAction SilentlyContinue | Where-Object { $j = Read-JobJson $_.FullName; -not ($j -and $j.status -eq 'running') }
}
function Get-StorageAreas {
  $jobFiles = foreach ($d in (Get-FinishedJobDirs)) { Get-TreeFiles $d.FullName }
  # the local voice engine never changes while the app runs: measure it once
  if ($null -eq $script:VoiceEngineSize) { $script:VoiceEngineSize = Get-FilesSize (Get-TreeFiles (Join-Path $Root 'voice')) }
  $areas = @(
    [ordered]@{ id = 'tts'; label = 'Spoken lines'; clear = $true; note = 'Voice lines made so far. They are made again when needed (a second or two each).'; size = (Get-FilesSize (Get-TreeFiles (Join-Path $CacheDir 'tts'))) }
    [ordered]@{ id = 'gamedata'; label = 'Game data'; clear = $true; note = 'Champion and item data per patch (Data Dragon). Downloaded again on the next start.'; size = (Get-FilesSize (Get-ChildItem $CacheDir -File -ErrorAction SilentlyContinue)) }
    [ordered]@{ id = 'jobs'; label = 'Research run logs'; clear = $true; note = 'Logs of finished agent runs. Their results are already in your playbooks. Running jobs are kept.'; size = (Get-FilesSize $jobFiles) }
    [ordered]@{ id = 'playbooks'; label = 'Your playbooks'; clear = $false; note = 'Researched and updated champion playbooks with all versions. Manage them in the Playbook tab.'; size = (Get-FilesSize (Get-TreeFiles $LocalPb)) }
    [ordered]@{ id = 'archive'; label = 'Your match archive'; clear = $false; note = 'Every game of yours Riot still had, kept for good (Riot deletes games after about two years). Review, reports and stats read it.'; size = (Get-FilesSize @(@(Get-TreeFiles $ArchiveDir) + @(Get-TreeFiles $GamesDir))) }
    [ordered]@{ id = 'history'; label = 'Live game records'; clear = $false; note = 'What the dashboard said in games you played with Jax Coach open.'; size = (Get-FilesSize (Get-ChildItem $HistoryDir -File -ErrorAction SilentlyContinue)) }
    [ordered]@{ id = 'voice'; label = 'Local voice engine'; clear = $false; note = 'The installed Kokoro voice. Uninstalling Jax Coach removes it.'; size = $script:VoiceEngineSize }
  )
  return $areas
}
function Clear-StorageArea([string]$id) {
  switch ($id) {
    'tts' { Get-TreeFiles (Join-Path $CacheDir 'tts') | Remove-Item -Force -ErrorAction SilentlyContinue }
    'gamedata' { Get-ChildItem $CacheDir -File -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue }
    'jobs' { Get-FinishedJobDirs | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue }
    default { return $false }
  }
  return $true
}
function Handle-Storage($ctx, [string]$sub) {
  if ($ctx.Request.HttpMethod -eq 'POST' -and $sub -match '^/clear/(\w+)$') {
    if (-not (Clear-StorageArea $Matches[1])) { Send $ctx 400 '{"error":"not_clearable"}'; return }
  }
  Send $ctx 200 (ConvertTo-Json @(Get-StorageAreas) -Depth 4 -Compress)
}

# ---------------- updates (app\update.ps1 does the work) ----------------
$UpdateScript = Join-Path $Root 'app\update.ps1'
function Handle-Update($ctx, [string]$sub) {
  $status = Join-Path $Root 'logs\update-status.json'
  if ($sub -eq '/check') {
    $tmp = [IO.Path]::GetTempFileName()
    try {
      $p = Start-Process powershell.exe -PassThru -WindowStyle Hidden -RedirectStandardOutput $tmp `
        -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$UpdateScript`"", '-Check')
      if (-not $p.WaitForExit(45000)) { try { $p.Kill() } catch {}; Send $ctx 200 '{"error":"The check took too long (no network?)"}'; return }
      $out = (Get-Content $tmp -Raw -ErrorAction SilentlyContinue)
      Send $ctx 200 $(if ($out) { $out.Trim() } else { '{"error":"The check did not answer"}' })
    } finally { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
    return
  }
  if ($sub -eq '/apply' -and $ctx.Request.HttpMethod -eq 'POST') {
    [IO.File]::WriteAllText($status, '{"state":"starting","message":"Starting the update..."}')
    Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$UpdateScript`"", '-Apply')
    Send $ctx 202 '{"ok":true}'
    return
  }
  if ($sub -eq '/status') { Send $ctx 200 $(if (Test-Path $status) { Get-Content $status -Raw } else { '{"state":"idle"}' }); return }
  $b = Join-Path $Root 'app\build.json'
  Send $ctx 200 ('{"current":' + $(if (Test-Path $b) { (Get-Content $b -Raw).Trim() } else { 'null' }) + '}')
}

# ---------------- router ----------------
function Handle-Request($ctx) {
  $req = $ctx.Request
  $raw = $req.RawUrl
  $path = $raw.Split('?')[0]

  if ($path -eq '/api/live') {
    # Windows takes ~1-2s to refuse a connection to a closed local port, and this server is single-threaded:
    # only ask the game when its process actually exists.
    if (-not (Get-Process -Name 'League of Legends' -ErrorAction SilentlyContinue)) { Send $ctx 200 '{"inGame":false,"status":-1}'; return }
    $r = [JcHttp]::Get('https://127.0.0.1:2999/liveclientdata/allgamedata', $null, 1500)
    if ($r.Status -eq 200 -and $r.Body -match '"activePlayer"') { Send $ctx 200 $r.Body }
    else { Send $ctx 200 ('{"inGame":false,"status":' + $r.Status + '}') }
    return
  }
  if ($path -eq '/api/config') {
    if ($req.HttpMethod -eq 'POST') {
      $reader = New-Object IO.StreamReader($req.InputStream, [Text.Encoding]::UTF8)
      $in = $reader.ReadToEnd() | ConvertFrom-Json
      if ($in.riotApiKey) { $Config.riotApiKey = "$($in.riotApiKey)".Trim(); $script:KeySource = 'config.json' }
      if ($in.platform) { $Config.platform = "$($in.platform)".ToLower() }
      # never copy a key that came from a .env file into config.json
      $toSave = [ordered]@{}; foreach ($k in $Config.Keys) { $toSave[$k] = $Config[$k] }
      if ($script:KeySource -ne 'config.json') { $toSave.riotApiKey = '' }
      Save-Config $toSave
      $RiotCache.Clear()
    }
    $hint = if ($Config.riotApiKey) { $k = "$($Config.riotApiKey)"; '...' + $k.Substring([Math]::Max(0, $k.Length - 4)) } else { '' }
    Send $ctx 200 ('{"hasKey":' + ([bool]$Config.riotApiKey).ToString().ToLower() + ',"keyHint":' + (Json-Escape $hint) + ',"keySource":' + (Json-Escape $script:KeySource) + ',"hasGroq":' + ([bool]$script:GroqKey).ToString().ToLower() + ',"hasKokoro":' + ([bool]$script:HasKokoro).ToString().ToLower() + ',"kokoroPort":' + $KokoroPort + ',"platform":' + (Json-Escape $Config.platform) + '}')
    return
  }
  if ($path -match '^/api/dd/(champion|item|runesReforged)$') {
    $body = Get-DDFile $Matches[1]
    if ($body) { Send $ctx 200 $body } else { Send $ctx 502 '{"error":"ddragon_unavailable"}' }
    return
  }
  if ($raw -match '^/api/riot/(platform|match|account)(/.*)$') { Handle-Riot $ctx $Matches[1] $Matches[2]; return }
  if ($path -match '^/api/lcu(/.*)$') { Handle-Lcu $ctx $Matches[1]; return }
  if ($path -eq '/api/loadout/apply') { Handle-LoadoutApply $ctx; return }
  if ($path -eq '/api/replay/playback') { Handle-Replay $ctx; return }
  if ($path -eq '/api/replay/config') {
    # read-only: is the Replay API switched on in the game's config file?
    $null = Get-Lcu
    $cfg = if ($script:LeagueDir) { Join-Path $script:LeagueDir 'Config\game.cfg' } else { $null }
    $enabled = $false; $found = $false
    if ($cfg -and (Test-Path $cfg)) { $found = $true; $enabled = [bool]((Get-Content $cfg -Raw) -match '(?m)^\s*EnableReplayApi\s*=\s*1') }
    Send $ctx 200 ('{"found":' + $found.ToString().ToLower() + ',"enabled":' + $enabled.ToString().ToLower() + ',"path":' + (Json-Escape "$cfg") + '}')
    return
  }
  if ($path -eq '/api/history') { Handle-History $ctx; return }
  if ($path -match '^/api/archive(/.*)?$') { Handle-Archive $ctx "$($Matches[1])"; return }
  if ($path -match '^/api/storage(/.*)?$') { Handle-Storage $ctx "$($Matches[1])"; return }
  if ($path -match '^/api/update(/\w+)?$') { Handle-Update $ctx "$($Matches[1])"; return }
  if ($path -match '^/api/playbooks?(/.*)?$') { Handle-Playbook $ctx "$($Matches[1])"; return }
  if ($path -match '^/api/agent(/.*)$') { Handle-Agent $ctx $Matches[1]; return }
  if ($path -eq '/api/tts') { Handle-Tts $ctx; return }
  if ($path -like '/data/*') { Send-File $ctx $DataDir ([Uri]::UnescapeDataString($path.Substring(6))); return }
  if ($path -eq '/') { $path = '/index.html' }
  Send-File $ctx $Public ([Uri]::UnescapeDataString($path.TrimStart('/')))
}

# ---------------- main loop ----------------
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
try { $listener.Start() } catch {
  Write-Host "Could not start on port $Port (already running?): $_" -ForegroundColor Red
  Start-Process "http://localhost:$Port/"
  exit 1
}
# local voice (Kokoro, voice\): started here so every way of launching Jax Coach gets it. It lowers its own
# priority, uses 2 CPU threads and quits by itself when this server exits.
$KokoroPort = 8788
$script:HasKokoro = $false
$kpy = Join-Path $Root 'voice\.venv\Scripts\pythonw.exe'
$kscript = Join-Path $Root 'voice\kokoro_server.py'
if ((Test-Path $kpy) -and (Test-Path $kscript) -and (Test-Path (Join-Path $Root 'voice\models\kokoro-v1.0.onnx'))) {
  $already = [JcHttp]::Get("http://127.0.0.1:$KokoroPort/health", $null, 800)
  if ($already.Status -ne 200) {
    # "voiceDevice" in config.json: cpu (default, "auto") or gpu (DirectML: faster, but sounds metallic on a GTX 1070)
    $dev = "$($Config.voiceDevice)".ToLower(); if ($dev -notin @('auto', 'gpu', 'cpu')) { $dev = 'auto' }
    Start-Process -FilePath $kpy -ArgumentList @("`"$kscript`"", '--port', $KokoroPort, '--app-port', $Port, '--parent-pid', $PID, '--device', $dev) -WindowStyle Hidden | Out-Null
  }
  $script:HasKokoro = $true
}

Write-Host ""
Write-Host "  Jax Coach running at http://localhost:$Port/" -ForegroundColor Cyan
$keyMsg = if ($Config.riotApiKey) { "loaded from $script:KeySource" } else { 'not set (scouting off; add RIOT_API_KEY=RGAPI-... to ~/.env)' }
Write-Host "  Region: $($Config.platform)   Riot API key: $keyMsg"
$voiceMsg = @(); if ($script:HasKokoro) { $voiceMsg += 'local Kokoro voice (port 8788)' }; if ($script:GroqKey) { $voiceMsg += 'Groq (key found)' }
Write-Host "  Voice: $(if ($voiceMsg) { $voiceMsg -join ' + ' } else { 'Windows voices' })"
Write-Host "  Leave this window open while you play. Close it (or Ctrl+C) to stop."
Write-Host ""
if (-not $env:JAXCOACH_NO_BROWSER) { Start-Process "http://localhost:$Port/" }

try {
  $pending = $listener.GetContextAsync()
  while ($listener.IsListening) {
    try { Update-AgentJobs } catch { Write-Host "Agent jobs: $_" -ForegroundColor Yellow }
    if (-not $pending.Wait(500)) { continue }
    $ctx = $pending.Result
    $pending = $listener.GetContextAsync()
    try { Handle-Request $ctx }
    catch {
      Write-Host "Error on $($ctx.Request.RawUrl): $_" -ForegroundColor Yellow
      try { Send $ctx 500 ('{"error":' + (Json-Escape "$_") + '}') } catch {}
    }
  }
} finally { $listener.Stop() }
