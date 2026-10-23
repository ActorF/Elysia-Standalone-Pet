param(
  [Parameter(Mandatory = $true)][string]$TargetHwnd,
  [Parameter(Mandatory = $true)][int]$ParentProcessId
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class ElysiaTaskbarOrder {
    [DllImport("user32.dll")] private static extern IntPtr GetTopWindow(IntPtr parent);
    [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr hwnd, uint command);
    [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr hwnd, StringBuilder name, int capacity);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] private static extern IntPtr GetWindowLongPtr64(IntPtr hwnd, int index);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")] private static extern int GetWindowLong32(IntPtr hwnd, int index);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int width, int height, uint flags);

    private static bool Owned(IntPtr hwnd, uint parentProcessId) {
        uint processId;
        GetWindowThreadProcessId(hwnd, out processId);
        return IsWindow(hwnd) && processId == parentProcessId;
    }
    private static bool Topmost(IntPtr hwnd) {
        long style = IntPtr.Size == 8 ? GetWindowLongPtr64(hwnd, -20).ToInt64() : GetWindowLong32(hwnd, -20);
        return (style & 8) != 0;
    }
    public static bool Tick(IntPtr own, uint parentProcessId) {
        if (!Owned(own, parentProcessId)) return false;
        if (!IsWindowVisible(own) || IsIconic(own)) return true;
        IntPtr cursor = GetTopWindow(IntPtr.Zero), lowestTaskbar = IntPtr.Zero;
        int rank = 0, ownRank = -1, taskbarRank = -1;
        HashSet<IntPtr> seen = new HashSet<IntPtr>();
        List<int> visibleRanks = new List<int>();
        while (cursor != IntPtr.Zero && rank < 20000 && seen.Add(cursor)) {
            if (cursor == own) ownRank = rank;
            if (IsWindowVisible(cursor)) {
                visibleRanks.Add(rank);
                StringBuilder name = new StringBuilder(256);
                GetClassName(cursor, name, name.Capacity);
                string className = name.ToString();
                if ((className == "Shell_TrayWnd" || className == "Shell_SecondaryTrayWnd") && Topmost(cursor)) {
                    lowestTaskbar = cursor; taskbarRank = rank;
                }
            }
            cursor = GetWindow(cursor, 2); rank++; // GW_HWNDNEXT, top to bottom.
        }
        if (cursor != IntPtr.Zero || ownRank < 0 || lowestTaskbar == IntPtr.Zero) return true;
        bool visibleWindowBetween = false;
        foreach (int visibleRank in visibleRanks) {
            if (visibleRank > taskbarRank && visibleRank < ownRank) { visibleWindowBetween = true; break; }
        }
        if (Topmost(own) && ownRank > taskbarRank && !visibleWindowBetween) return true;
        if (!Owned(own, parentProcessId) || !IsWindowVisible(own) || IsIconic(own)) return true;
        // Never activate, resize, move or show a window. Only our own HWND is
        // passed as the window to change; taskbars are read-only insertion anchors.
        const uint flags = 0x0001 | 0x0002 | 0x0010; // NOSIZE | NOMOVE | NOACTIVATE
        if (!Topmost(own)) SetWindowPos(own, new IntPtr(-1), 0, 0, 0, 0, flags); // HWND_TOPMOST
        if (Owned(own, parentProcessId) && IsWindowVisible(own) && !IsIconic(own) &&
            IsWindow(lowestTaskbar) && IsWindowVisible(lowestTaskbar) && Topmost(lowestTaskbar))
            SetWindowPos(own, lowestTaskbar, 0, 0, 0, 0, flags);
        return true;
    }
}
'@

$taskbarWindow = [IntPtr]::new([Convert]::ToInt64($TargetHwnd.Replace('0x', ''), 16))
$taskbarParent = [System.Diagnostics.Process]::GetProcessById($ParentProcessId)
try {
  if (-not [ElysiaTaskbarOrder]::Tick($taskbarWindow, $ParentProcessId)) { exit 1 }
  [Console]::WriteLine('READY')
  while (-not $taskbarParent.HasExited) {
    Start-Sleep -Milliseconds 100
    if (-not [ElysiaTaskbarOrder]::Tick($taskbarWindow, $ParentProcessId)) { break }
  }
} finally { $taskbarParent.Dispose() }
