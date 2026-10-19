# Integration test only: refuse injection unless the intended pet test window is in the foreground.
param([long]$ExpectedWindow)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class PetInputTest {
  [StructLayout(LayoutKind.Sequential)] public struct Mouse { public int x, y; public uint data, flags, time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] public struct Keyboard { public ushort key, scan; public uint flags, time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] public struct InputData { [FieldOffset(0)] public Mouse mouse; [FieldOffset(0)] public Keyboard keyboard; }
  [StructLayout(LayoutKind.Sequential)] public struct Input { public uint type; public InputData data; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", SetLastError=true)] private static extern uint SendInput(uint count, Input[] inputs, int size);
  public static void Key(ushort key, bool release) {
    var input = new Input { type = 1, data = new InputData { keyboard = new Keyboard { key = key, flags = release ? 2u : 0u } } };
    if (SendInput(1, new[] { input }, Marshal.SizeOf(typeof(Input))) != 1) throw new Win32Exception(Marshal.GetLastWin32Error());
  }
}
'@
if ([PetInputTest]::GetForegroundWindow().ToInt64() -ne $ExpectedWindow) {
  throw 'Test target is not the foreground window. No input was sent.'
}
try {
  [PetInputTest]::Key(0x20, $false)
  [PetInputTest]::Key(0x31, $false)
  Start-Sleep -Milliseconds 120
} finally {
  [PetInputTest]::Key(0x31, $true)
  [PetInputTest]::Key(0x20, $true)
}
