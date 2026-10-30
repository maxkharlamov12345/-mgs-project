# Удаление плагина MGS 3D из PRO100
Add-Type -AssemblyName System.Windows.Forms
$me = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""; exit }
$d = New-Object Windows.Forms.OpenFileDialog; $d.Title = 'Укажите PRO100.exe'; $d.Filter = 'PRO100|PRO100.exe'
if ($d.ShowDialog() -ne 'OK') { exit }
$plug = Join-Path (Split-Path $d.FileName) 'plugins'
while (Get-Process -Name PRO100 -ErrorAction SilentlyContinue) {
  $r = [Windows.Forms.MessageBox]::Show('PRO100 ещё работает (возможно, в фоне).`n«Да» — закрыть PRO100 сейчас (несохранённые изменения пропадут).`n«Нет» — я закрою сам, проверить ещё раз.', 'MGS 3D', 'YesNoCancel')
  if ($r -eq 'Yes') { Stop-Process -Name PRO100 -Force; Start-Sleep 1 } elseif ($r -eq 'Cancel') { exit } }
Get-Process -Name powershell -ErrorAction SilentlyContinue | Where-Object { $_.Id -ne $PID -and $_.MainWindowTitle -eq '' } | ForEach-Object { try { if ((Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)").CommandLine -match 'mgs3d_send') { Stop-Process -Id $_.Id -Force } } catch {} }
$left = @()
foreach ($f in Get-ChildItem $plug -Filter 'mgs3d*') { try { Remove-Item $f.FullName -Force -ErrorAction Stop } catch { $left += $f.Name } }
if ($left.Count) { [Windows.Forms.MessageBox]::Show("Не удалось удалить: $($left -join ', ').`nПерезагрузите компьютер и запустите «Удалить.cmd» ещё раз.", 'MGS 3D') | Out-Null }
else { [Windows.Forms.MessageBox]::Show('Плагин MGS 3D удалён.', 'MGS 3D') | Out-Null }
