# Установка плагина MGS 3D в PRO100
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
function Msg($t, $icon = 'Information') { [Windows.Forms.MessageBox]::Show($t, 'MGS 3D — установка', 'OK', $icon) | Out-Null }

# права администратора (папка PRO100 обычно в Program Files)
$me = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  exit
}
$Src = Split-Path -Parent $PSCommandPath

# где стоит PRO100
$cands = New-Object Collections.ArrayList
try { $k = Get-ItemProperty 'HKCU:\Software\KK3D\PRO100' -ErrorAction Stop; if ($k.PRO100Exe) { [void]$cands.Add($k.PRO100Exe) }; if ($k.InstallDir) { [void]$cands.Add((Join-Path $k.InstallDir 'PRO100.exe')) } } catch {}
foreach ($root in 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*','HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*') {
  Get-ItemProperty $root -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match 'PRO100|PRO 100' -and $_.DisplayName -notmatch 'KK-3D|MGS' } | ForEach-Object {
    if ($_.InstallLocation) { [void]$cands.Add((Join-Path $_.InstallLocation 'PRO100.exe')) }
    if ($_.DisplayIcon) { [void]$cands.Add(($_.DisplayIcon -replace ',\d+$','' -replace '"','')) }
  }
}
foreach ($pf in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, 'C:\', 'D:\')) {
  if ($pf -and (Test-Path $pf)) { Get-ChildItem $pf -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'PRO100|PRO 100|Ecru' } | ForEach-Object {
    Get-ChildItem $_.FullName -Filter PRO100.exe -Recurse -Depth 2 -ErrorAction SilentlyContinue | ForEach-Object { [void]$cands.Add($_.FullName) } } }
}
$exe = $cands | Where-Object { $_ -and (Test-Path $_) -and ((Split-Path $_ -Leaf) -ieq 'PRO100.exe') } | Select-Object -Unique
if (@($exe).Count -ne 1) {
  $d = New-Object Windows.Forms.OpenFileDialog
  $d.Title = 'Укажите PRO100.exe'; $d.Filter = 'PRO100|PRO100.exe|Программы|*.exe'
  $first = @($exe)[0]; if ($first) { $d.InitialDirectory = Split-Path $first }
  if ($d.ShowDialog() -ne 'OK') { exit }
  $exe = $d.FileName
}
$exe = @($exe)[0]
$ver = (Get-Item $exe).VersionInfo.ProductVersion
if (Get-Process -Name PRO100 -ErrorAction SilentlyContinue) { Msg 'Закройте PRO100 и нажмите OK — установка продолжится.' 'Warning'
  while (Get-Process -Name PRO100 -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 500; if (-not (Get-Process -Name PRO100 -ErrorAction SilentlyContinue)) { break }; Msg 'PRO100 всё ещё открыт. Закройте его и нажмите OK.' 'Warning' } }

$plug = Join-Path (Split-Path $exe) 'plugins'
New-Item -ItemType Directory -Force -Path $plug | Out-Null
$withDims = Test-Path (Join-Path $Src 'mgsdims.plg')   # плагин размеров кладём, только если он есть в архиве (в рабочей версии его нет)
try {
  foreach ($f in 'mgs3d.plg','mgs3d_send.ps1') { Copy-Item (Join-Path $Src $f) $plug -Force -ErrorAction Stop }
  if ($withDims) { Copy-Item (Join-Path $Src 'mgsdims.plg') $plug -Force -ErrorAction Stop }
  elseif (Test-Path (Join-Path $plug 'mgsdims.plg')) { Remove-Item (Join-Path $plug 'mgsdims.plg') -Force -ErrorAction Stop }
}
catch { Msg "Не удалось заменить файлы плагина — похоже, PRO100 ещё работает в фоне.`nОткройте Диспетчер задач, снимите задачу PRO100 (или перезагрузите компьютер) и запустите «Установить.cmd» снова." 'Error'; exit }
# скачанные раньше обновления (%LOCALAPPDATA%\MGS3D\bin) — убираем: свежая установка главнее, дальше обновится сама
Remove-Item (Join-Path $env:LOCALAPPDATA 'MGS3D\bin') -Recurse -Force -ErrorAction SilentlyContinue
$iniDst = Join-Path $plug 'mgs3d.ini'
# старый ini (облако supabase.co) заменяем — сервер переехал на api.mgsmebel.com
if (-not (Test-Path $iniDst) -or (Select-String -Path $iniDst -Pattern 'supabase\.co' -Quiet)) { Copy-Item (Join-Path $Src 'mgs3d.ini') $plug -Force }
Get-ChildItem $plug -Filter 'mgs*' | Unblock-File -ErrorAction SilentlyContinue
if ($withDims) { Msg "Плагин MGS 3D установлен.`n`nPRO100: $exe (версия $ver)`n`nОткройте PRO100:`n• Экспорт → «Размеры MGS…» — поставить размеры для клиента;`n• Экспорт → «Отправить в MGS 3D…» — модель и размеры уходят на сайт." }
else { Msg "Плагин MGS 3D установлен.`n`nPRO100: $exe (версия $ver)`n`nОткройте PRO100 → Экспорт → «Отправить в MGS 3D…» — модель уходит на сайт, клиенту — ссылка." }
