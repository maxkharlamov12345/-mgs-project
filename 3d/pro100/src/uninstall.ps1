# Удаление плагина MGS 3D из PRO100
Add-Type -AssemblyName System.Windows.Forms
$me = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""; exit }
$d = New-Object Windows.Forms.OpenFileDialog; $d.Title = 'Укажите PRO100.exe'; $d.Filter = 'PRO100|PRO100.exe'
if ($d.ShowDialog() -ne 'OK') { exit }
$plug = Join-Path (Split-Path $d.FileName) 'plugins'
Get-ChildItem $plug -Filter 'mgs3d*' | Remove-Item -Force
[Windows.Forms.MessageBox]::Show('Плагин MGS 3D удалён.', 'MGS 3D') | Out-Null
