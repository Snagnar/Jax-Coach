# Jax Coach - champion playbooks and research agents (dot-sourced by server.ps1).
#
# Playbooks: data\champions\<Champ>\ ships with the app; playbooks\<Champ>\v<N>\ holds versions made on this PC
# (research agents, approved changes). The newest active local version wins, file by file.
#
# Research agents: each job runs Claude Code headless ("claude -p") in its own folder under jobs\. It may only
# search the web, read the reference files copied into its folder and write its answer to out\. It can't run
# commands (restricted mode) and can't touch any other file. The server watches the folders, installs finished
# playbooks and the page reads plans and proposals from out\.

$PbParts = @('meta', 'phases', 'matchups', 'rules')
function Read-Text([string]$p) { return [IO.File]::ReadAllText($p, [Text.Encoding]::UTF8) }
function Write-Text([string]$p, [string]$s) { [IO.File]::WriteAllText($p, $s, (New-Object Text.UTF8Encoding($false))) }
function Read-Body($ctx) { return (New-Object IO.StreamReader($ctx.Request.InputStream, [Text.Encoding]::UTF8)).ReadToEnd() }
function Safe-Champ([string]$c) { if ($c -match '^[A-Za-z0-9_]{1,24}$') { return $c }; return $null }
function JBool($b) { if ($b) { 'true' } else { 'false' } }

# ---------------- playbooks ----------------
function Get-PbState([string]$champ) {
  $f = Join-Path $LocalPb "$champ\state.json"
  if (Test-Path $f) { try { return (Read-Text $f | ConvertFrom-Json) } catch {} }
  return [pscustomobject]@{ active = 0; draft = 0; versions = @() }
}
function Save-PbState([string]$champ, $st) {
  $dir = Join-Path $LocalPb $champ
  New-Item -ItemType Directory -Force $dir | Out-Null
  Write-Text (Join-Path $dir 'state.json') ($st | ConvertTo-Json -Depth 6)
}
function Get-PbPartFile([string]$champ, [string]$part) {
  $st = Get-PbState $champ
  if ($st.active -gt 0) {
    $f = Join-Path $LocalPb "$champ\v$($st.active)\$part.json"
    if (Test-Path $f) { return $f }
  }
  $f = Join-Path $ShippedPb "$champ\$part.json"
  if (Test-Path $f) { return $f }
  return $null
}
function Get-PbSource([string]$champ, [string]$part) {
  $f = Get-PbPartFile $champ $part
  if (-not $f) { return $null }
  if ($f.StartsWith($LocalPb)) { return 'local' }
  return 'shipped'
}
function Get-PlaybookJson([string]$champ) {
  $st = Get-PbState $champ
  $sb = New-Object Text.StringBuilder
  [void]$sb.Append('{"champion":' + (Json-Escape $champ) + ',"activeVersion":' + [int]$st.active + ',"draft":' + (JBool ($st.draft -gt 0 -and $st.draft -eq $st.active)))
  $src = @()
  foreach ($p in $PbParts) {
    $f = Get-PbPartFile $champ $p
    $body = if ($f) { Read-Text $f } else { 'null' }
    [void]$sb.Append(',"' + $p + '":' + $body)
    $src += ('"' + $p + '":' + $(if ($f) { Json-Escape (Get-PbSource $champ $p) } else { 'null' }))
  }
  [void]$sb.Append(',"source":{' + ($src -join ',') + '}}')
  return $sb.ToString()
}
function Get-PbPatch([string]$champ) {
  $f = Get-PbPartFile $champ 'meta'
  if (-not $f) { return $null }
  $head = Read-Text $f; if ($head.Length -gt 800) { $head = $head.Substring(0, 800) }
  if ($head -match '"patch"\s*:\s*"([^"]+)"') { return $Matches[1] }
  return $null
}
function List-PlaybooksJson {
  $names = @()
  if (Test-Path $ShippedPb) { $names += Get-ChildItem $ShippedPb -Directory | Where-Object { $_.Name -notlike '_*' } | ForEach-Object Name }
  $names += Get-ChildItem $LocalPb -Directory | ForEach-Object Name
  $out = foreach ($n in ($names | Sort-Object -Unique)) {
    if (-not (Safe-Champ $n)) { continue }
    $st = Get-PbState $n
    $parts = ($PbParts | ForEach-Object { '"' + $_ + '":' + $(if (Get-PbPartFile $n $_) { Json-Escape (Get-PbSource $n $_) } else { 'null' }) }) -join ','
    $vers = @($st.versions | ForEach-Object { '{"v":' + [int]$_.v + ',"created":' + (Json-Escape "$($_.created)") + ',"source":' + (Json-Escape "$($_.source)") + ',"note":' + (Json-Escape "$($_.note)") + '}' }) -join ','
    '{"champion":' + (Json-Escape $n) + ',"shipped":' + (JBool (Test-Path (Join-Path $ShippedPb $n))) + ',"active":' + [int]$st.active + ',"draft":' + (JBool ($st.draft -gt 0 -and $st.draft -eq $st.active)) + ',"patch":' + (Json-Escape "$(Get-PbPatch $n)") + ',"parts":{' + $parts + '},"versions":[' + $vers + ']}'
  }
  return '[' + (@($out) -join ',') + ']'
}
function Test-PartJson([string]$part, [string]$text) {
  try { $o = ConvertFrom-Json $text } catch { return "not valid JSON: $($_.Exception.Message)" }
  switch ($part) {
    'meta'     { if (-not $o.coreBuild -and -not $o.runes) { return 'meta.json needs coreBuild and runes' } }
    'phases'   { if (@($o.phases).Count -lt 3) { return 'phases.json needs a phases list' } }
    'matchups' { if (-not $o.matchups) { return 'matchups.json needs a "matchups" object' } }
    'rules'    { if (@($o.modes).Count -lt 3) { return 'rules.json needs a modes list' } }
  }
  return $null
}
# $parts: part name -> JSON text. Unchanged parts are carried over from the active version.
function New-PbVersion([string]$champ, [hashtable]$parts, [string]$source, [string]$note, [int]$intoVersion = 0) {
  $st = Get-PbState $champ
  $v = if ($intoVersion -gt 0) { $intoVersion } else { ([int](@($st.versions | ForEach-Object { [int]$_.v }) + 0 | Measure-Object -Maximum).Maximum) + 1 }
  $dir = Join-Path $LocalPb "$champ\v$v"
  $isNew = -not (Test-Path $dir)
  New-Item -ItemType Directory -Force $dir | Out-Null
  if ($isNew) {
    foreach ($p in $PbParts) {
      if ($parts.ContainsKey($p)) { continue }
      $prev = Get-PbPartFile $champ $p
      if ($prev) { Copy-Item $prev (Join-Path $dir "$p.json") }
    }
  }
  foreach ($p in $parts.Keys) { Write-Text (Join-Path $dir "$p.json") $parts[$p] }
  if ($isNew) {
    $entry = [pscustomobject]@{ v = $v; created = (Get-Date -Format 's'); source = $source; note = $note }
    $st.versions = @($st.versions) + $entry
  } else {
    foreach ($e in $st.versions) { if ([int]$e.v -eq $v) { $e.note = $note; $e.source = $source } }
  }
  $st.active = $v
  Save-PbState $champ $st
  return $v
}
function Handle-Playbook($ctx, [string]$rest) {
  $req = $ctx.Request
  if ($rest -eq '' -or $rest -eq '/') { Send $ctx 200 (List-PlaybooksJson); return }
  if ($rest -notmatch '^/([A-Za-z0-9_]{1,24})(/(version|activate))?$') { Send $ctx 404 '{"error":"not_found"}'; return }
  $champ = $Matches[1]; $action = $Matches[3]
  if (-not $action) { Send $ctx 200 (Get-PlaybookJson $champ); return }
  if ($req.HttpMethod -ne 'POST') { Send $ctx 405 '{"error":"post_only"}'; return }
  $in = Read-Body $ctx | ConvertFrom-Json
  if ($action -eq 'activate') {
    $st = Get-PbState $champ
    $v = [int]$in.version
    if ($v -ne 0 -and -not (@($st.versions | Where-Object { [int]$_.v -eq $v }).Count)) { Send $ctx 400 '{"error":"no_such_version"}'; return }
    $st.active = $v; Save-PbState $champ $st
    Send $ctx 200 (Get-PlaybookJson $champ); return
  }
  # new version from the page: { parts: { rules: "<json text>", ... }, note, source }
  $parts = @{}
  foreach ($p in $PbParts) {
    $t = $in.parts.$p
    if (-not $t) { continue }
    $err = Test-PartJson $p $t
    if ($err) { Send $ctx 400 ('{"error":' + (Json-Escape "${p}: $err") + '}'); return }
    $parts[$p] = $t
  }
  if (-not $parts.Count) { Send $ctx 400 '{"error":"no_parts"}'; return }
  $src = if ($in.source) { "$($in.source)" } else { 'manual' }
  $null = New-PbVersion $champ $parts $src "$($in.note)"
  Send $ctx 200 (Get-PlaybookJson $champ)
}

# ---------------- Claude Code ----------------
$script:ClaudeExe = $null
$script:ClaudeAuth = $null; $script:ClaudeAuthAt = [DateTime]::MinValue
function Find-Claude {
  if ($script:ClaudeExe -and (Test-Path $script:ClaudeExe)) { return $script:ClaudeExe }
  $cands = @((Join-Path $HOME '.local\bin\claude.exe'), (Join-Path $env:APPDATA 'npm\claude.cmd'))
  $cmd = Get-Command claude -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($cmd) { $cands = @($cmd.Source) + $cands }
  foreach ($c in $cands) { if ($c -and (Test-Path $c)) { $script:ClaudeExe = $c; return $c } }
  return $null
}
function Get-ClaudeAuth([bool]$refresh) {
  $exe = Find-Claude
  if (-not $exe) { return $null }
  if (-not $refresh -and $script:ClaudeAuth -and ((Get-Date) - $script:ClaudeAuthAt).TotalMinutes -lt 10) { return $script:ClaudeAuth }
  try {
    $psi = New-Object Diagnostics.ProcessStartInfo
    $psi.FileName = $exe; $psi.Arguments = 'auth status'; $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
    $p = [Diagnostics.Process]::Start($psi)
    $out = $p.StandardOutput.ReadToEnd(); $null = $p.WaitForExit(8000)
    $script:ClaudeAuth = ($out | ConvertFrom-Json)
    $script:ClaudeAuthAt = Get-Date
  } catch { $script:ClaudeAuth = $null }
  return $script:ClaudeAuth
}
function Agent-Models {
  $deep = if ($Config.agentModelDeep) { "$($Config.agentModelDeep)" } else { 'claude-opus-5-5' }
  $fast = if ($Config.agentModel) { "$($Config.agentModel)" } else { 'claude-sonnet-5-5' }
  $sub  = if ($Config.agentSubagentModel) { "$($Config.agentSubagentModel)" } else { 'claude-sonnet-5-5' }
  return @{ deep = $deep; fast = $fast; sub = $sub }
}

# ---------------- jobs ----------------
# model: deep (new champion research) or fast; maxMin: the job is stopped after that long
$JobTypes = @{
  champion = @{ model = 'deep'; maxMin = 60; installs = $true;  tools = 'Read,Write,Edit,Glob,Grep,WebSearch,WebFetch,Agent' }
  quick    = @{ model = 'fast'; maxMin = 10; installs = $true;  tools = 'Read,Write,Edit,Glob,Grep,WebSearch,WebFetch' }
  gameplan = @{ model = 'fast'; maxMin = 10; installs = $false; tools = 'Read,Write,Edit,Glob,Grep,WebSearch,WebFetch' }
  adapt    = @{ model = 'fast'; maxMin = 8;  installs = $false; tools = 'Read,Write,Edit,Glob,Grep,WebSearch,WebFetch' }
  review   = @{ model = 'fast'; maxMin = 20; installs = $false; tools = 'Read,Write,Edit,Glob,Grep,WebSearch,WebFetch' }
}
$script:JobsTickAt = [DateTime]::MinValue

function Read-JobJson([string]$dir) { try { return (Read-Text (Join-Path $dir 'job.json') | ConvertFrom-Json) } catch { return $null } }
function Save-JobJson([string]$dir, $job) { Write-Text (Join-Path $dir 'job.json') ($job | ConvertTo-Json -Depth 6) }
function Job-Alive($job) {
  if (-not $job.pid) { return $false }
  $p = Get-Process -Id ([int]$job.pid) -ErrorAction SilentlyContinue
  return [bool]($p -and $p.StartTime.Ticks -eq [long]$job.startTicks)
}
function Copy-Reference([string]$dir, [string]$type, [string]$champ) {
  $ref = Join-Path $dir 'reference'
  New-Item -ItemType Directory -Force $ref | Out-Null
  Copy-Item (Join-Path $AgentsDir 'playbook-format.md') $ref
  if (Test-Path (Join-Path $DataDir 'shared.json')) { Copy-Item (Join-Path $DataDir 'shared.json') $ref }
  if ($type -in @('champion', 'quick')) {
    $ex = Join-Path $ref 'example-Jax'; New-Item -ItemType Directory -Force $ex | Out-Null
    foreach ($p in $PbParts) { $f = Join-Path $ShippedPb "Jax\$p.json"; if (Test-Path $f) { Copy-Item $f $ex } }
  }
  if ($champ) {
    $cur = Join-Path $ref 'current'
    $any = $false
    foreach ($p in $PbParts) { $f = Get-PbPartFile $champ $p; if ($f) { if (-not $any) { New-Item -ItemType Directory -Force $cur | Out-Null; $any = $true }; Copy-Item $f (Join-Path $cur "$p.json") } }
    if (-not $any -and $type -notin @('champion', 'quick')) {
      $gen = Join-Path $ShippedPb '_generic'
      if (Test-Path $gen) { New-Item -ItemType Directory -Force $cur | Out-Null; Copy-Item (Join-Path $gen '*.json') $cur }
    }
  }
}
function Start-AgentJob([string]$body) {
  $in = $body | ConvertFrom-Json
  $type = "$($in.type)"
  if (-not $JobTypes.ContainsKey($type)) { return @{ status = 400; body = '{"error":"unknown_job_type"}' } }
  $exe = Find-Claude
  if (-not $exe) { return @{ status = 503; body = '{"error":"claude_not_installed"}' } }
  $champ = Safe-Champ "$($in.champion)"
  $key = if ($in.key) { "$($in.key)" } else { "$type-$champ" }
  # one running job per key (e.g. one research run per champion)
  foreach ($d in (Get-ChildItem $JobsDir -Directory -ErrorAction SilentlyContinue)) {
    $j = Read-JobJson $d.FullName
    if ($j -and $j.status -eq 'running' -and $j.key -eq $key) { return @{ status = 200; body = (Read-Text (Join-Path $d.FullName 'job.json')) } }
  }
  $id = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + $type + $(if ($champ) { "-$champ" } else { '' }) + '-' + (Get-Random -Maximum 9999)
  $dir = Join-Path $JobsDir $id
  New-Item -ItemType Directory -Force $dir, (Join-Path $dir 'out') | Out-Null
  Write-Text (Join-Path $dir 'input.json') $body
  Copy-Reference $dir $type $champ
  $tpl = Join-Path $AgentsDir "prompts\$type.md"
  if (-not (Test-Path $tpl)) { return @{ status = 500; body = '{"error":"prompt_missing"}' } }
  $prompt = (Read-Text $tpl).Replace('{{CHAMPION}}', "$champ").Replace('{{CHAMPION_NAME}}', "$(if ($in.championName) { $in.championName } else { $champ })").
    Replace('{{ROLE}}', "$(if ($in.role) { $in.role } else { 'top' })").Replace('{{DATE}}', (Get-Date -Format 'yyyy-MM-dd')).Replace('{{PATCH}}', "$($in.patch)")
  Write-Text (Join-Path $dir 'prompt.md') $prompt
  $models = Agent-Models
  $model = if ($in.model -and "$($in.model)" -match '^[A-Za-z0-9._-]+$') { "$($in.model)" } else { $models[$JobTypes[$type].model] }
  $tools = $JobTypes[$type].tools
  $cmd = @(
    '@echo off', 'chcp 65001 >nul',
    "set CLAUDE_CODE_SUBAGENT_MODEL=$($models.sub)",
    "`"$exe`" -p --model $model --output-format stream-json --verbose --restricted --strict-mcp-config --tools `"$tools`" --allowedTools `"$tools`" --permission-mode acceptEdits --no-session-persistence < prompt.md > events.jsonl 2> stderr.txt",
    '>exit.txt echo %ERRORLEVEL%'
  ) -join "`r`n"
  [IO.File]::WriteAllText((Join-Path $dir 'run.cmd'), $cmd + "`r`n", [Text.Encoding]::ASCII)
  # started through WMI, so the job is not a child of this server: restarting or quitting Jax Coach doesn't kill it
  $startup = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }
  $r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine = "`"$(Join-Path $env:WINDIR 'System32\cmd.exe')`" /c `"$(Join-Path $dir 'run.cmd')`""; CurrentDirectory = $dir; ProcessStartupInformation = $startup }
  if ($r.ReturnValue -ne 0) { return @{ status = 500; body = ('{"error":' + (Json-Escape "could not start the agent (WMI code $($r.ReturnValue))") + '}') } }
  $p = Get-Process -Id ([int]$r.ProcessId)
  $st = Get-PbState $champ
  $hasPb = [bool]($champ -and ((Test-Path (Join-Path $ShippedPb $champ)) -or ($st.active -gt 0)))
  $job = [pscustomobject]@{
    id = $id; type = $type; champion = $champ; key = $key; title = "$($in.title)"; model = $model
    status = 'running'; created = (Get-Date -Format 's'); finished = $null; pid = $p.Id; startTicks = $p.StartTime.Ticks
    newChampion = (-not $hasPb) -or ($st.draft -gt 0 -and $st.draft -eq $st.active); installed = @(); warnings = @(); error = $null
  }
  Save-JobJson $dir $job
  Write-Host "Agent job started: $id ($model)" -ForegroundColor Cyan
  return @{ status = 200; body = (Read-Text (Join-Path $dir 'job.json')) }
}
function Merge-MatchupParts($files, [string]$champ) {
  $all = [ordered]@{}; $role = 'top'; $notes = $null
  foreach ($f in ($files | Sort-Object Name)) {
    try { $o = Read-Text $f.FullName | ConvertFrom-Json } catch { continue }
    if ($o.role) { $role = $o.role }
    if ($o._notes -and -not $notes) { $notes = $o._notes }
    $src = if ($o.matchups) { $o.matchups } else { $o }
    foreach ($m in $src.PSObject.Properties) { if ($m.Value -is [pscustomobject] -and $m.Name -notlike '_*' -and $m.Name -notin @('champion', 'role')) { $all[$m.Name] = $m.Value } }
  }
  if (-not $all.Count) { return $null }
  $res = [ordered]@{ champion = $champ; role = $role }
  if ($notes) { $res._notes = $notes }
  $res.matchups = $all
  return ($res | ConvertTo-Json -Depth 40)
}
# install finished parts of a champion job. For a champion without a playbook, parts go live as they arrive.
function Install-JobParts([string]$dir, $job, [bool]$final) {
  $champ = $job.champion
  if (-not $champ) { return }
  $outDir = Join-Path $dir 'out'
  $parts = @{}
  foreach ($p in $PbParts) {
    $f = Join-Path $outDir "$p.json"
    if (-not (Test-Path $f)) {
      # research splits matchups over several sub-agents (matchups_part1.json, ...): merge them here
      if ($p -ne 'matchups') { continue }
      $pieces = @(Get-ChildItem $outDir -Filter 'matchups_part*.json' -ErrorAction SilentlyContinue | Where-Object { $final -or ((Get-Date) - $_.LastWriteTime).TotalSeconds -ge 5 })
      if (-not $pieces.Count) { continue }
      $stamp = "matchups@parts-" + (($pieces | ForEach-Object { "$($_.Name):$($_.LastWriteTime.Ticks)" }) -join ',')
      if (@($job.installed) -contains $stamp) { continue }
      $text = Merge-MatchupParts $pieces $champ
      if (-not $text) { continue }
    } else {
      $item = Get-Item $f
      if (-not $final -and ((Get-Date) - $item.LastWriteTime).TotalSeconds -lt 5) { continue }   # still being written
      $stamp = "$p@$($item.LastWriteTime.Ticks)"
      if (@($job.installed) -contains $stamp) { continue }
      $text = Read-Text $f
    }
    $err = Test-PartJson $p $text
    if ($err) { if (@($job.warnings) -notcontains "${p}: $err") { $job.warnings = @($job.warnings) + "${p}: $err" }; continue }
    $parts[$p] = $text
    $job.installed = @(@($job.installed) | Where-Object { $_ -notlike "$p@*" }) + $stamp
  }
  $st = Get-PbState $champ
  if (-not $parts.Count) {
    # the research finished and everything was already installed while it ran: the draft is now the real playbook
    if ($final -and $job.type -eq 'champion' -and $job.newChampion -and $st.draft -gt 0) {
      foreach ($e in $st.versions) { if ([int]$e.v -eq [int]$st.draft) { $e.note = 'Full research' } }
      $st.draft = 0; Save-PbState $champ $st
    }
    return
  }
  $label = if ($job.type -eq 'quick') { 'quick research' } else { 'research' }
  if ($job.newChampion) {
    # one draft version that fills up while the research runs
    $into = if ($st.draft -gt 0) { [int]$st.draft } else { 0 }
    $v = New-PbVersion $champ $parts "job:$($job.id)" $(if ($final -and $job.type -eq 'champion') { "Full $label" } else { "Draft ($label running)" }) $into
    $st = Get-PbState $champ
    $st.draft = if ($final -and $job.type -eq 'champion') { 0 } else { $v }
    Save-PbState $champ $st
  } elseif ($final -and $job.type -eq 'champion') {
    $null = New-PbVersion $champ $parts "job:$($job.id)" "Research update"
  }
}
function Get-JobResult([string]$dir) {
  $f = Join-Path $dir 'events.jsonl'
  if (-not (Test-Path $f)) { return $null }
  $fs = [IO.File]::Open($f, 'Open', 'Read', 'ReadWrite')
  try {
    $len = $fs.Length; $take = [Math]::Min($len, 65536)
    $null = $fs.Seek($len - $take, 'Begin')
    $buf = New-Object byte[] $take; $null = $fs.Read($buf, 0, $take)
    $tail = [Text.Encoding]::UTF8.GetString($buf)
  } finally { $fs.Close() }
  $res = $null
  foreach ($line in ($tail -split "`n")) {
    if ($line -match '^\{.*"type":"result"') { try { $res = $line | ConvertFrom-Json } catch {} }
  }
  return $res
}
# what the agent is doing right now: the recent tool calls (searches, pages, sub-agents, files)
function Get-JobActivity([string]$dir, [int]$max = 12) {
  $f = Join-Path $dir 'events.jsonl'
  if (-not (Test-Path $f)) { return @() }
  $fs = [IO.File]::Open($f, 'Open', 'Read', 'ReadWrite')
  try {
    $len = $fs.Length; $take = [Math]::Min($len, 400000)
    $null = $fs.Seek($len - $take, 'Begin')
    $buf = New-Object byte[] $take; $null = $fs.Read($buf, 0, $take)
    $tail = [Text.Encoding]::UTF8.GetString($buf)
  } finally { $fs.Close() }
  $acts = New-Object Collections.ArrayList
  $re = [regex]'"type":"tool_use","id":"[^"]*","name":"(\w+)","input":\{"(?:[^"]*)":"((?:[^"\\]|\\.){0,300})'
  foreach ($m in $re.Matches($tail)) {
    $arg = $m.Groups[2].Value -replace '\\"', '"' -replace '\\\\', '\' -replace '\\n', ' '
    if ($m.Groups[1].Value -in @('Write', 'Edit', 'Read')) { $arg = $arg -replace '^.*[\\/]', '' }
    [void]$acts.Add('{"tool":' + (Json-Escape $m.Groups[1].Value) + ',"arg":' + (Json-Escape $arg) + '}')
  }
  $n = $acts.Count
  $lastN = if ($n -gt $max) { $acts.GetRange($n - $max, $max) } else { $acts }
  return @{ count = $n; recent = @($lastN) }
}
function Update-AgentJobs {
  if (((Get-Date) - $script:JobsTickAt).TotalSeconds -lt 3) { return }
  $script:JobsTickAt = Get-Date
  foreach ($d in (Get-ChildItem $JobsDir -Directory -ErrorAction SilentlyContinue)) {
    $job = Read-JobJson $d.FullName
    if (-not $job -or $job.status -ne 'running') { continue }
    $cfg = $JobTypes["$($job.type)"]
    $alive = Job-Alive $job
    $age = ((Get-Date) - [DateTime]::Parse($job.created)).TotalMinutes
    if ($alive -and $cfg -and $age -gt $cfg.maxMin) {
      & taskkill.exe /T /F /PID $job.pid 2>&1 | Out-Null
      $job.status = 'failed'; $job.error = "Stopped after $([int]$cfg.maxMin) minutes"; $job.finished = (Get-Date -Format 's')
      Save-JobJson $d.FullName $job; continue
    }
    if ($alive) {
      if ($cfg -and $cfg.installs -and $job.newChampion) { Install-JobParts $d.FullName $job $false; Save-JobJson $d.FullName $job }
      continue
    }
    $exitF = Join-Path $d.FullName 'exit.txt'
    $code = if (Test-Path $exitF) { (Read-Text $exitF).Trim() } else { '' }
    $res = Get-JobResult $d.FullName
    $ok = ($code -eq '0') -and $res -and (-not $res.is_error)
    $job.finished = (Get-Date -Format 's')
    if ($res) { $job | Add-Member -NotePropertyName costUsd -NotePropertyValue $res.total_cost_usd -Force; $job | Add-Member -NotePropertyName durationSec -NotePropertyValue ([int]($res.duration_ms / 1000)) -Force }
    if ($ok) {
      $job.status = 'done'
      if ($cfg -and $cfg.installs) { Install-JobParts $d.FullName $job $true }
    } else {
      $job.status = 'failed'
      $errTxt = ''
      $ef = Join-Path $d.FullName 'stderr.txt'
      if (Test-Path $ef) { $errTxt = (Read-Text $ef).Trim() }
      if (-not $errTxt -and $res) { $errTxt = "$($res.subtype): $($res.result)" }
      if (-not $errTxt) { $errTxt = if ($code) { "exit code $code" } else { 'stopped' } }
      if ($errTxt.Length -gt 600) { $errTxt = $errTxt.Substring($errTxt.Length - 600) }
      $job.error = $errTxt
      # a failed research run may still have written usable files
      if ($cfg -and $cfg.installs) { Install-JobParts $d.FullName $job $true }
    }
    Save-JobJson $d.FullName $job
    Write-Host "Agent job $($job.status): $($job.id)" -ForegroundColor $(if ($ok) { 'Green' } else { 'Yellow' })
  }
}
function Job-Json([string]$dir, [bool]$withActivity) {
  $jobText = Read-Text (Join-Path $dir 'job.json')
  $outs = @(Get-ChildItem (Join-Path $dir 'out') -File -ErrorAction SilentlyContinue | ForEach-Object { Json-Escape $_.Name }) -join ','
  $extra = ',"outputs":[' + $outs + ']'
  if ($withActivity) {
    $a = Get-JobActivity $dir
    $extra += ',"activity":{"count":' + [int]$a.count + ',"recent":[' + (@($a.recent) -join ',') + ']}'
  }
  return $jobText.TrimEnd().TrimEnd('}') + $extra + '}'
}
function Handle-Agent($ctx, [string]$rest) {
  $req = $ctx.Request
  if ($rest -eq '/status') {
    $exe = Find-Claude
    $auth = Get-ClaudeAuth ([bool]($req.QueryString['refresh']))
    $m = Agent-Models
    Send $ctx 200 ('{"installed":' + (JBool $exe) + ',"path":' + (Json-Escape "$exe") + ',"loggedIn":' + (JBool ($auth -and $auth.loggedIn)) + ',"authMethod":' + (Json-Escape "$(if ($auth) { $auth.authMethod })") + ',"models":{"deep":' + (Json-Escape $m.deep) + ',"fast":' + (Json-Escape $m.fast) + ',"sub":' + (Json-Escape $m.sub) + '}}')
    return
  }
  if ($rest -eq '/login' -and $req.HttpMethod -eq 'POST') {
    # opens a console window where you sign in to your Claude account (the page can't do it for you)
    $exe = Find-Claude
    if (-not $exe) { Send $ctx 503 '{"error":"claude_not_installed"}'; return }
    Start-Process -FilePath (Join-Path $env:WINDIR 'System32\cmd.exe') -ArgumentList @('/k', "title Sign in to Claude & `"$exe`" auth login & echo. & echo You can close this window now.")
    $script:ClaudeAuthAt = [DateTime]::MinValue
    Send $ctx 200 '{"ok":true}'; return
  }
  if ($rest -eq '/jobs') {
    if ($req.HttpMethod -eq 'POST') { $r = Start-AgentJob (Read-Body $ctx); Send $ctx $r.status $r.body; return }
    $dirs = Get-ChildItem $JobsDir -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 40
    $items = foreach ($d in $dirs) { if (Test-Path (Join-Path $d.FullName 'job.json')) { $j = Read-JobJson $d.FullName; Job-Json $d.FullName ($j -and $j.status -eq 'running') } }
    Send $ctx 200 ('[' + (@($items) -join ',') + ']'); return
  }
  if ($rest -match '^/jobs/([A-Za-z0-9_-]+)(/cancel|/out/([A-Za-z0-9_.-]+))?$') {
    $dir = Join-Path $JobsDir $Matches[1]
    if (-not (Test-Path (Join-Path $dir 'job.json'))) { Send $ctx 404 '{"error":"no_such_job"}'; return }
    if ($Matches[2] -eq '/cancel') {
      $job = Read-JobJson $dir
      if ($job.status -eq 'running' -and (Job-Alive $job)) { & taskkill.exe /T /F /PID $job.pid 2>&1 | Out-Null }
      $job.status = 'cancelled'; $job.finished = (Get-Date -Format 's'); Save-JobJson $dir $job
      Send $ctx 200 (Job-Json $dir $false); return
    }
    if ($Matches[3]) { Send-File $ctx (Join-Path $dir 'out') $Matches[3]; return }
    Send $ctx 200 (Job-Json $dir $true); return
  }
  Send $ctx 404 '{"error":"not_found"}'
}
