# Passive Space-combination detection only. No keyboard hook, key suppression or key log.
param([int]$ParentProcessId = 0)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PetKeys {
    [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key);
}
'@
$keyMap = [ordered]@{
  '1' = 0x31; '2' = 0x32; '3' = 0x33; '4' = 0x34; '5' = 0x35
  '6' = 0x36; '7' = 0x37; '8' = 0x38; '9' = 0x39; '0' = 0x30
  'F1' = 0x70; 'F2' = 0x71; 'F3' = 0x72; 'F4' = 0x73; 'F5' = 0x74; 'F6' = 0x75
  'Backspace' = 0x08
}
$held = @{}
[Console]::WriteLine('READY')
$parentCheck = 0
while ($true) {
  if ($ParentProcessId -gt 0 -and $parentCheck -eq 0) {
    try { $null = [System.Diagnostics.Process]::GetProcessById($ParentProcessId) } catch { break }
  }
  $parentCheck = ($parentCheck + 1) % 50
  if (([int][PetKeys]::GetAsyncKeyState(0x20) -band 0x8000) -ne 0) {
    foreach ($entry in $keyMap.GetEnumerator()) {
      $down = ([int][PetKeys]::GetAsyncKeyState($entry.Value) -band 0x8000) -ne 0
      # Support both the main digit row and numeric keypad without double toggling.
      if ($entry.Key -match '^\d$') {
        $numpadKey = 0x60 + [int]::Parse($entry.Key)
        $down = $down -or (([int][PetKeys]::GetAsyncKeyState($numpadKey) -band 0x8000) -ne 0)
      }
      if ($down -and -not $held[$entry.Key]) { [Console]::WriteLine($entry.Key) }
      $held[$entry.Key] = $down
    }
  } else { $held.Clear() }
  Start-Sleep -Milliseconds 20
}
