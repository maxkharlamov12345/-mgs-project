# MGS 3D — окно отправки модели из PRO100 в кабинет MGS 3D.
# Запускается плагином mgs3d.plg после экспорта в OBJ: -Dir <папка экспорта> -Title <заголовок окна PRO100>
param([string]$Dir, [string]$Title = '')

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.Windows.Forms, System.Drawing, System.Net.Http
[System.Windows.Forms.Application]::EnableVisualStyles()

$Here    = Split-Path -Parent $PSCommandPath
$Data    = Join-Path $env:LOCALAPPDATA 'MGS3D'
$LogFile = Join-Path $Data 'logs\send.log'
New-Item -ItemType Directory -Force -Path (Join-Path $Data 'logs') | Out-Null
function Log($m) { Add-Content -Path $LogFile -Value ("{0:HH:mm:ss}  {1}" -f (Get-Date), $m) -Encoding UTF8 }
Log "=== запуск: $Dir | $Title"

# ---------- настройки ----------
function Read-Ini($path) {
  $r = @{}; $sec = ''
  if (Test-Path $path) {
    foreach ($l in Get-Content $path -Encoding UTF8) {
      $l = $l.Trim()
      if ($l -match '^\[(.+)\]$') { $sec = $Matches[1]; continue }
      if ($l -match '^([^;=]+)=(.*)$') { $r["$sec.$($Matches[1].Trim())"] = $Matches[2].Trim() }
    }
  }
  $r
}
$Ini  = Read-Ini (Join-Path $Here 'mgs3d.ini')
$Url  = if ($Ini['service.url']) { $Ini['service.url'].TrimEnd('/') } else { 'https://api.mgsmebel.com' }
$Key  = if ($Ini['service.key']) { $Ini['service.key'] } else { 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzkzMzc1NDI2LCJleHAiOjIxMDg3MzU0MjZ9.exy6cZNIkPj-oxZPuafx1BiBEQO4Hsav4bCQ2Z3mbDs' }
$Site = if ($Ini['service.site']) { $Ini['service.site'].TrimEnd('/') } else { 'https://my.mgsmebel.com' }
$Kinds = @('Кухня','Шкаф','Гардеробная','Прихожая','Ванная','Детская','Гостиная','Другое')

# ---------- сеть ----------
$script:Token = $null
function Body($o) { $j = $o | ConvertTo-Json -Depth 6 -Compress; return ,([byte[]][Text.Encoding]::UTF8.GetBytes($j)) }
function Api($method, $path, $body = $null, $extra = @{}) {
  $h = @{ apikey = $Key }
  if ($script:Token) { $h.Authorization = "Bearer $script:Token" }
  foreach ($k in $extra.Keys) { $h[$k] = $extra[$k] }
  $p = @{ Method = $method; Uri = "$Url$path"; Headers = $h; UseBasicParsing = $true }
  if ($null -ne $body) { $p.Body = [byte[]](Body $body); $p.ContentType = 'application/json; charset=utf-8' }
  $resp = Invoke-WebRequest @p
  $txt = [Text.Encoding]::UTF8.GetString($resp.RawContentStream.ToArray())
  if (!$txt) { return $null }
  $o = ConvertFrom-Json $txt
  if ($o -is [array]) { foreach ($i in $o) { $i } } else { $o }   # по одному элементу: вызывающий собирает через @()
}
# ждать задачу .NET, не замораживая окно
function Wait-Task($t) { while (-not $t.IsCompleted) { [Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 40 }; if ($t.IsFaulted) { throw $t.Exception.InnerException } }
# сжатие текстовых файлов модели (OBJ ужимается в 5–8 раз; лимит Supabase — 50 МБ на файл)
function Gzip-File($src, $dst) {
  $in = [IO.File]::OpenRead($src); $out = [IO.File]::Create($dst)
  $gz = New-Object IO.Compression.GZipStream($out, [IO.Compression.CompressionLevel]::Optimal)
  try { Wait-Task ($in.CopyToAsync($gz, 1048576)) } finally { $gz.Dispose(); $out.Dispose(); $in.Dispose() }
}
$script:Http = New-Object Net.Http.HttpClient; $script:Http.Timeout = [TimeSpan]::FromMinutes(30)
function Upload-File($file, $path, $ct) {
  $fs = [IO.File]::OpenRead($file)
  try {
    $req = New-Object Net.Http.HttpRequestMessage([Net.Http.HttpMethod]::Post, "$Url/storage/v1/object/models/$path")
    [void]$req.Headers.TryAddWithoutValidation('apikey', $Key)
    [void]$req.Headers.TryAddWithoutValidation('Authorization', "Bearer $script:Token")
    [void]$req.Headers.TryAddWithoutValidation('x-upsert', 'true')
    $req.Content = New-Object Net.Http.StreamContent($fs)
    $req.Content.Headers.ContentType = [Net.Http.Headers.MediaTypeHeaderValue]::Parse($ct)
    $t = $script:Http.SendAsync($req); Wait-Task $t
    $r = $t.Result
    if (-not $r.IsSuccessStatusCode) {
      $b = $r.Content.ReadAsStringAsync().Result
      if ($b -match 'maximum allowed size|too large|413') { throw "Сервер: файл $([IO.Path]::GetFileName($file)) слишком большой ($([math]::Round((Get-Item $file).Length/1MB,1)) МБ, предел 50 МБ)." }
      throw "Сервер ответил ошибкой $([int]$r.StatusCode) при загрузке. $b"
    }
  } finally { $fs.Dispose() }
}

function Why($e) {
  if ($e.Exception.Message -like 'Сервер*') { return $e.Exception.Message }
  $ex = $e.Exception; while ($ex.InnerException -and -not $ex.Response) { $ex = $ex.InnerException }
  $r = $null; try { $r = $e.Exception.Response } catch {}
  if (-not $r) {
    return "Нет связи с сервером MGS 3D (api.mgsmebel.com).`n$($e.Exception.Message)`nПроверьте интернет и попробуйте ещё раз."
  }
  $code = [int]$r.StatusCode; $body = ''
  try { $sr = New-Object IO.StreamReader($r.GetResponseStream()); $body = $sr.ReadToEnd() } catch {}
  if ($code -eq 400 -and $body -match 'invalid_credentials|Invalid login') { return 'Неверная почта или пароль. Введите те же, что на сайте кабинета.' }
  if ($body -match 'email_not_confirmed') { return 'Почта не подтверждена. В Supabase у пользователя должна стоять галочка Auto Confirm.' }
  "Сервер ответил ошибкой $code.`n" + ($body.Substring(0, [math]::Min(200, $body.Length)))
}
function ErrText($e) {
  $t = $e.Exception.Message
  try {
    $r = $e.Exception.Response
    if ($r) { $s = New-Object IO.StreamReader($r.GetResponseStream()); $t = "$t`n$($s.ReadToEnd())" }
  } catch {}
  $t
}

# ---------- вход (ключ хранится зашифрованным средствами Windows) ----------
$SessFile = Join-Path $Data 'session.dat'
function Save-Session($rt) { ConvertTo-SecureString $rt -AsPlainText -Force | ConvertFrom-SecureString | Set-Content $SessFile }
function Load-Session {
  if (!(Test-Path $SessFile)) { return $null }
  try {
    $ss = Get-Content $SessFile | ConvertTo-SecureString
    [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($ss))
  } catch { $null }
}
function Use-Auth($a) { $script:Token = $a.access_token; $script:Email = $a.user.email; Save-Session $a.refresh_token }
function Try-Refresh {
  $rt = Load-Session; if (!$rt) { return $false }
  try { $script:Token = $null; Use-Auth (Api 'POST' '/auth/v1/token?grant_type=refresh_token' @{ refresh_token = $rt }); return $true }
  catch { Log ("refresh: " + (ErrText $_)); return $false }
}

# ---------- что отправляем ----------
$Exts = '\.(obj|mtl|png|jpe?g|bmp|gif|webp|tga)$'
$Files = @(Get-ChildItem -Path $Dir -Recurse -File | Where-Object { $_.Name -match $Exts })
$seen = @{}; $Files = @($Files | Where-Object { $k = $_.Name.ToLower(); if ($seen[$k]) { $false } else { $seen[$k] = 1; $true } })
$ObjFile = $Files | Where-Object { $_.Extension -ieq '.obj' } | Select-Object -First 1
$TotalMB = [math]::Round((($Files | Measure-Object Length -Sum).Sum) / 1MB, 1)

function Guess-Title($t) {
  if ($t -match '([^\\/:*?"<>|]+)\.(sto|pro|p100|prj|s3d)\b') { return $Matches[1].Trim() }
  $t = $t -replace 'PRO100\s*[\d\.]*', '' -replace '^[\s\-–—|:]+|[\s\-–—|:]+$', ''
  if ($t) { $t } else { 'Изделие' }
}
function Guess-Kind($t) {
  $l = $t.ToLower()
  foreach ($p in @(@('кух','Кухня'),@('гардероб','Гардеробная'),@('шкаф','Шкаф'),@('прихож','Прихожая'),@('ванн','Ванная'),@('сануз','Ванная'),@('детск','Детская'),@('гостин','Гостиная'))) {
    if ($l.Contains($p[0])) { return $p[1] }
  }
  'Шкаф'
}

# ---------- окно ----------
$Lime = [Drawing.Color]::FromArgb(191,214,48); $Ink = [Drawing.Color]::FromArgb(20,26,3)
$Bg = [Drawing.Color]::FromArgb(15,14,12); $Card = [Drawing.Color]::FromArgb(29,32,34); $Fg = [Drawing.Color]::FromArgb(244,241,236); $Muted = [Drawing.Color]::FromArgb(141,147,140)
$F  = New-Object Drawing.Font('Segoe UI', 10)
$FB = New-Object Drawing.Font('Segoe UI Semibold', 10)
$FH = New-Object Drawing.Font('Segoe UI Semibold', 15)

$form = New-Object Windows.Forms.Form
$form.Text = 'MGS 3D — отправка модели'; $form.StartPosition = 'CenterScreen'; $form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false; $form.MinimizeBox = $false; $form.ClientSize = New-Object Drawing.Size(460, 470)
$form.BackColor = $Bg; $form.ForeColor = $Fg; $form.Font = $F; $form.TopMost = $true
$ico = Join-Path $Here 'mgs3d.ico'; if (Test-Path $ico) { $form.Icon = New-Object Drawing.Icon($ico) }

function L($text, $x, $y, $w = 420, $font = $null, $color = $null) {
  $l = New-Object Windows.Forms.Label; $l.Text = $text; $l.Location = New-Object Drawing.Point($x, $y)
  $l.Size = New-Object Drawing.Size($w, 22); $l.AutoSize = $false
  if ($font) { $l.Font = $font }; if ($color) { $l.ForeColor = $color }; $l
}
function T($x, $y, $w = 420) { $t = New-Object Windows.Forms.TextBox; $t.Location = New-Object Drawing.Point($x, $y); $t.Width = $w; $t.BackColor = $Card; $t.ForeColor = $Fg; $t.BorderStyle = 'FixedSingle'; $t }
function C($x, $y, $w = 420) { $c = New-Object Windows.Forms.ComboBox; $c.DropDownStyle = 'DropDownList'; $c.Location = New-Object Drawing.Point($x, $y); $c.Width = $w; $c.BackColor = $Card; $c.ForeColor = $Fg; $c.FlatStyle = 'Flat'; $c }
function B($text, $x, $y, $w = 200, $primary = $true) {
  $b = New-Object Windows.Forms.Button; $b.Text = $text; $b.Location = New-Object Drawing.Point($x, $y); $b.Size = New-Object Drawing.Size($w, 38)
  $b.FlatStyle = 'Flat'; $b.Font = $FB; $b.Cursor = 'Hand'
  if ($primary) { $b.BackColor = $Lime; $b.ForeColor = $Ink; $b.FlatAppearance.BorderSize = 0 } else { $b.BackColor = $Bg; $b.ForeColor = $Fg; $b.FlatAppearance.BorderColor = [Drawing.Color]::FromArgb(60,64,68) }
  $b
}
function Panel { $p = New-Object Windows.Forms.Panel; $p.Dock = 'Fill'; $p.BackColor = $Bg; $p.Visible = $false; $form.Controls.Add($p); $p }

# --- вход ---
$pLogin = Panel
$pLogin.Controls.AddRange(@(
  (L 'MGS 3D' 20 18 420 $FH),
  (L 'Войдите один раз — дальше модели будут отправляться сразу.' 20 52 420 $null $Muted),
  (L 'Почта' 20 92 420 $null $Muted)))
$tEmail = T 20 116; $pLogin.Controls.Add($tEmail)
$pLogin.Controls.Add((L 'Пароль' 20 152 420 $null $Muted))
$tPass = T 20 176; $tPass.UseSystemPasswordChar = $true; $pLogin.Controls.Add($tPass)
$bLogin = B 'Войти' 20 222 420; $pLogin.Controls.Add($bLogin)
$lLoginMsg = L '' 20 272 420 $null $Muted; $lLoginMsg.Height = 150; $pLogin.Controls.Add($lLoginMsg)

# --- отправка ---
$pMain = Panel
$lHead = L 'Отправить модель' 20 16 420 $FH; $pMain.Controls.Add($lHead)
$lInfo = L '' 20 48 420 $null $Muted; $pMain.Controls.Add($lInfo)
$pMain.Controls.Add((L 'Проект' 20 82 300 $null $Muted))
$lnkNew = New-Object Windows.Forms.LinkLabel; $lnkNew.Text = '+ Новый проект'; $lnkNew.Location = New-Object Drawing.Point(320, 82); $lnkNew.Size = New-Object Drawing.Size(120, 22)
$lnkNew.TextAlign = 'TopRight'; $lnkNew.LinkColor = $Lime; $lnkNew.ActiveLinkColor = $Lime; $pMain.Controls.Add($lnkNew)
$cProj = C 20 106; $pMain.Controls.Add($cProj)
$gNew = New-Object Windows.Forms.Panel; $gNew.Location = New-Object Drawing.Point(20, 140); $gNew.Size = New-Object Drawing.Size(420, 120); $gNew.Visible = $false; $pMain.Controls.Add($gNew)
$gNew.Controls.Add((L 'Название проекта' 0 0 420 $null $Muted)); $tPT = T 0 22; $gNew.Controls.Add($tPT)
$gNew.Controls.Add((L 'Клиент' 0 56 205 $null $Muted)); $tPC = T 0 78 205; $gNew.Controls.Add($tPC)
$gNew.Controls.Add((L 'Адрес' 215 56 205 $null $Muted)); $tPA = T 215 78 205; $gNew.Controls.Add($tPA)
$gItem = New-Object Windows.Forms.Panel; $gItem.Location = New-Object Drawing.Point(20, 146); $gItem.Size = New-Object Drawing.Size(420, 70); $pMain.Controls.Add($gItem)
$gItem.Controls.Add((L 'Изделие' 0 0 270 $null $Muted)); $tItem = T 0 22 270; $gItem.Controls.Add($tItem)
$gItem.Controls.Add((L 'Тип' 280 0 140 $null $Muted)); $cKind = C 280 22 140; $cKind.Items.AddRange($Kinds); $gItem.Controls.Add($cKind)
$bSend = B 'Отправить' 20 236 420; $pMain.Controls.Add($bSend)
$bar = New-Object Windows.Forms.ProgressBar; $bar.Location = New-Object Drawing.Point(20, 286); $bar.Size = New-Object Drawing.Size(420, 8); $bar.Visible = $false; $pMain.Controls.Add($bar)
$lStatus = L '' 20 300 420 $null $Muted; $lStatus.Height = 120; $pMain.Controls.Add($lStatus)
$lWho = L '' 20 432 300 $null $Muted; $pMain.Controls.Add($lWho)
$lnkOut = New-Object Windows.Forms.LinkLabel; $lnkOut.Text = 'Выйти'; $lnkOut.Location = New-Object Drawing.Point(340, 432); $lnkOut.Size = New-Object Drawing.Size(100, 22); $lnkOut.TextAlign = 'TopRight'
$lnkOut.LinkColor = $Muted; $pMain.Controls.Add($lnkOut)

# --- готово ---
$pDone = Panel
$pDone.Controls.Add((L 'Готово' 20 18 420 $FH))
$lDone = L '' 20 54 420 $null $Muted; $lDone.Height = 44; $pDone.Controls.Add($lDone)
$pDone.Controls.Add((L 'Ссылка для клиента' 20 104 420 $null $Muted))
$tLink = T 20 128; $tLink.ReadOnly = $true; $pDone.Controls.Add($tLink)
$bOpen = B 'Открыть в 3D' 20 172 205; $pDone.Controls.Add($bOpen)
$bCopy = B 'Скопировать ссылку' 235 172 205 $false; $pDone.Controls.Add($bCopy)
$bClose = B 'Закрыть' 20 222 420 $false; $pDone.Controls.Add($bClose)

function Show-Panel($p) { foreach ($x in @($pLogin, $pMain, $pDone)) { $x.Visible = ($x -eq $p) } }
function Busy($on, $text = '') { $form.UseWaitCursor = $on; $bSend.Enabled = -not $on; $bar.Visible = $on; $lStatus.ForeColor = $Muted; $lStatus.Text = $text; [Windows.Forms.Application]::DoEvents() }

$LastFile = Join-Path $Data 'last-project.txt'
$script:Projects = @()
function Load-Projects {
  $script:Projects = @(Api 'GET' '/rest/v1/projects?select=id,title,client,address,share_token&order=created_at.desc')
  $cProj.Items.Clear()
  foreach ($p in $script:Projects) { $cProj.Items.Add((@($p.title, $p.client, $p.address) | Where-Object { $_ }) -join ' · ') | Out-Null }
  $last = if (Test-Path $LastFile) { (Get-Content $LastFile -Encoding UTF8 | Select-Object -First 1) } else { '' }
  $i = [array]::FindIndex([object[]]$script:Projects, [Predicate[object]]{ param($p) $p.id -eq $last })
  if ($cProj.Items.Count) { $cProj.SelectedIndex = [math]::Max(0, $i) }
  if (!$cProj.Items.Count) { Set-NewMode $true }
}
$script:NewMode = $false
function Set-NewMode($on) {
  $script:NewMode = $on; $gNew.Visible = $on; $cProj.Enabled = -not $on
  $lnkNew.Text = if ($on) { 'Выбрать из списка' } else { '+ Новый проект' }
  $y = if ($on) { 270 } else { 146 }; $gItem.Top = $y; $bSend.Top = $y + 90; $bar.Top = $y + 140; $lStatus.Top = $y + 154
  if ($on) { $tPT.Focus() | Out-Null }
}
function Enter-Main {
  Show-Panel $pMain
  $lWho.Text = "Вы вошли: $script:Email"
  $lInfo.Text = "Файлов: $($Files.Count), $TotalMB МБ"
  $tItem.Text = Guess-Title $Title; $cKind.SelectedItem = Guess-Kind $tItem.Text
  try { Busy $true 'Загружаем проекты…'; Load-Projects; Busy $false }
  catch { Busy $false; $lStatus.ForeColor = [Drawing.Color]::Salmon; $lStatus.Text = 'Не удалось получить проекты. ' + (Why $_); Log ("projects: " + (ErrText $_)) }
}

$lnkNew.Add_LinkClicked({ Set-NewMode (-not $script:NewMode) })
$lnkOut.Add_LinkClicked({ Remove-Item $SessFile -ErrorAction SilentlyContinue; $script:Token = $null; Show-Panel $pLogin })
$bLogin.Add_Click({
  $lLoginMsg.ForeColor = $Muted; $lLoginMsg.Text = 'Проверяем…'; $bLogin.Enabled = $false; [Windows.Forms.Application]::DoEvents()
  $ok = $false
  try { $script:Token = $null; Use-Auth (Api 'POST' '/auth/v1/token?grant_type=password' @{ email = $tEmail.Text.Trim(); password = $tPass.Text }); $tPass.Text = ''; $ok = $true }
  catch { $lLoginMsg.ForeColor = [Drawing.Color]::Salmon; $lLoginMsg.Text = (Why $_); Log ("login: " + (ErrText $_)) }
  if ($ok) { try { Enter-Main } catch { Log ("main: " + (ErrText $_)); [Windows.Forms.MessageBox]::Show("Ошибка окна: $($_.Exception.Message)", 'MGS 3D') | Out-Null } }
  $bLogin.Enabled = $true
})
$tPass.Add_KeyDown({ if ($_.KeyCode -eq 'Enter') { $bLogin.PerformClick() } })

$bSend.Add_Click({
  try {
    if (!$ObjFile) { throw 'В папке экспорта нет model.obj' }
    Busy $true 'Готовим…'
    if ($script:NewMode) {
      if (!$tPT.Text.Trim()) { Busy $false; $lStatus.Text = 'Введите название проекта.'; return }
      $p = Api 'POST' '/rest/v1/projects' @{ title = $tPT.Text.Trim(); client = $(if ($tPC.Text.Trim()) { $tPC.Text.Trim() } else { $null }); address = $(if ($tPA.Text.Trim()) { $tPA.Text.Trim() } else { $null }) } @{ Prefer = 'return=representation' }
      $proj = @($p)[0]
    } else {
      if ($cProj.SelectedIndex -lt 0) { Busy $false; $lStatus.Text = 'Выберите проект.'; return }
      $proj = $script:Projects[$cProj.SelectedIndex]
    }
    Set-Content $LastFile $proj.id -Encoding UTF8
    $itemId = [guid]::NewGuid().ToString()
    $list = New-Object Collections.ArrayList
    $bar.Maximum = $Files.Count; $bar.Value = 0
    $tmp = Join-Path $env:TEMP ("mgs3d-" + $itemId); New-Item -ItemType Directory -Force -Path $tmp | Out-Null
    try {
    for ($i = 0; $i -lt $Files.Count; $i++) {
      $f = $Files[$i]; $ext = $f.Extension.ToLower(); $src = $f.FullName; $gz = $false
      if ($ext -in '.obj', '.mtl' -and $f.Length -gt 256KB) {
        $lStatus.Text = "Сжимаем $($f.Name) ($([math]::Round($f.Length/1MB,1)) МБ)…"; [Windows.Forms.Application]::DoEvents()
        $src = Join-Path $tmp ("f$i$ext.gz"); Gzip-File $f.FullName $src; $gz = $true
      }
      $path = "$($proj.id)/$itemId/f$i$ext" + $(if ($gz) { '.gz' } else { '' })
      $ct = if ($gz) { 'application/gzip' } else { switch -regex ($ext) { '\.(obj|mtl)' { 'text/plain; charset=utf-8' } '\.png' { 'image/png' } '\.jpe?g' { 'image/jpeg' } '\.bmp' { 'image/bmp' } '\.gif' { 'image/gif' } '\.webp' { 'image/webp' } default { 'application/octet-stream' } } }
      $mb = [math]::Round((Get-Item $src).Length / 1MB, 1)
      $lStatus.Text = "Отправляем $($i + 1) из $($Files.Count): $($f.Name) ($mb МБ)"; [Windows.Forms.Application]::DoEvents()
      Upload-File $src $path $ct
      $entry = @{ name = $f.Name; path = $path; size = (Get-Item $src).Length }; if ($gz) { $entry.gz = $true }
      [void]$list.Add($entry)
      $bar.Value = $i + 1
    }
    } finally { Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue }
    $lStatus.Text = 'Сохраняем изделие…'; [Windows.Forms.Application]::DoEvents()
    Api 'POST' '/rest/v1/items' @{ id = $itemId; project_id = $proj.id; title = $(if ($tItem.Text.Trim()) { $tItem.Text.Trim() } else { 'Изделие' }); kind = [string]$cKind.SelectedItem; files = $list } | Out-Null
    $link = "$Site/view.html?s=$($proj.share_token)&i=$itemId"
    Log "готово: $link"
    Busy $false
    $tLink.Text = $link
    $lDone.Text = "«$($tItem.Text.Trim())» добавлено в проект «$($proj.title)»."
    Show-Panel $pDone
    Start-Process $link
    try { Remove-Item -Recurse -Force $Dir } catch {}
  } catch {
    $t = ErrText $_; Log "send: $t"
    Busy $false
    $lStatus.ForeColor = [Drawing.Color]::Salmon
    $lStatus.Text = if ($t -match '401|JWT|expired') { 'Вход устарел — нажмите «Выйти» и войдите снова.' } else { 'Не получилось отправить. ' + (Why $_) }
  }
})
$bOpen.Add_Click({ Start-Process $tLink.Text })
$bCopy.Add_Click({ [Windows.Forms.Clipboard]::SetText($tLink.Text); $bCopy.Text = 'Скопировано' })
$bClose.Add_Click({ $form.Close() })

$form.Add_Shown({
  $form.Activate(); $form.TopMost = $false
  if (!$ObjFile) { [Windows.Forms.MessageBox]::Show('PRO100 не сохранил модель. Повторите «Отправить в MGS 3D…».', 'MGS 3D') | Out-Null; $form.Close(); return }
  if (Try-Refresh) { Enter-Main } else { Show-Panel $pLogin; $tEmail.Focus() | Out-Null }
})
$form.ShowInTaskbar = $true; $form.WindowState = 'Normal'
try { [void]$form.ShowDialog() } catch { Log ("form: " + (ErrText $_)); [Windows.Forms.MessageBox]::Show("Ошибка окна отправки:`n$($_.Exception.Message)", 'MGS 3D') | Out-Null }
