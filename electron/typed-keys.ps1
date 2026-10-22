# Passive, local single-character display. Never suppress input or retain typed text.
param([int]$ParentProcessId = 0, [switch]$SelfTest)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public static class PetTypedKeys {
    private delegate IntPtr HookProc(int code, IntPtr message, IntPtr data);
    private delegate void TimerProc(IntPtr window, uint message, UIntPtr timer, uint time);
    [StructLayout(LayoutKind.Sequential)] private struct KeyboardEvent { public uint vk, scan, flags, time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] private struct Point { public int x, y; }
    [StructLayout(LayoutKind.Sequential)] private struct Message { public IntPtr window; public uint message; public UIntPtr wParam; public IntPtr lParam; public uint time; public Point point; public uint extra; }
    [DllImport("user32.dll", SetLastError=true)] private static extern IntPtr SetWindowsHookEx(int id, HookProc callback, IntPtr module, uint thread);
    [DllImport("user32.dll")] private static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] private static extern IntPtr GetModuleHandle(string name);
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] private static extern short GetKeyState(int key);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, IntPtr process);
    [DllImport("user32.dll")] private static extern IntPtr GetKeyboardLayout(uint thread);
    [DllImport("user32.dll")] private static extern int GetKeyboardLayoutList(int count, [Out] IntPtr[] layouts);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern IntPtr LoadKeyboardLayout(string layout, uint flags);
    [DllImport("user32.dll")] private static extern bool UnloadKeyboardLayout(IntPtr layout);
    [DllImport("user32.dll")] private static extern uint MapVirtualKeyEx(uint key, uint mode, IntPtr layout);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int ToUnicodeEx(uint key, uint scan, byte[] state, StringBuilder output, int length, uint flags, IntPtr layout);
    [DllImport("user32.dll")] private static extern int GetMessage(out Message message, IntPtr window, uint min, uint max);
    [DllImport("user32.dll")] private static extern IntPtr DispatchMessage(ref Message message);
    [DllImport("user32.dll")] private static extern UIntPtr SetTimer(IntPtr window, UIntPtr id, uint milliseconds, TimerProc callback);
    [DllImport("user32.dll")] private static extern bool KillTimer(IntPtr window, UIntPtr id);
    [DllImport("user32.dll")] private static extern void PostQuitMessage(int exitCode);

    private static readonly byte[] keyState = new byte[256];
    private static readonly HookProc hookCallback = OnKey;
    private static readonly TimerProc timerCallback = OnTimer;
    private static readonly Stopwatch clock = new Stopwatch();
    private static IntPtr hook;
    private static int parentId, latest = -1;
    private static long nextParentCheck;

    // wFlags=4 keeps Windows' dead-key/composition state untouched (Windows 10+).
    private static int Translate(uint key, uint scan, byte[] state, IntPtr layout) {
        if ((state[0x11] & 0x80) != 0 || (state[0x12] & 0x80) != 0 ||
            (state[0x5b] & 0x80) != 0 || (state[0x5c] & 0x80) != 0) return -1;
        if (!(key == 0x20 || (key >= 0x30 && key <= 0x5a) || (key >= 0x60 && key <= 0x6f) ||
              (key >= 0xba && key <= 0xc0) || (key >= 0xdb && key <= 0xdf) || key == 0xe2)) return -1;
        StringBuilder output = new StringBuilder(8);
        int count = ToUnicodeEx(key, scan, state, output, output.Capacity, 4, layout);
        if (count != 1 || output.Length != 1) return -1;
        int value = output[0];
        return value >= 32 && value <= 126 ? value : -1;
    }
    private static bool Held(int key) { return (keyState[key] & 0x80) != 0; }
    private static IntPtr OnKey(int code, IntPtr message, IntPtr data) {
        try {
            if (code >= 0) {
                uint kind = unchecked((uint)message.ToInt64());
                if (kind == 0x100 || kind == 0x104 || kind == 0x101 || kind == 0x105) {
                    KeyboardEvent e = (KeyboardEvent)Marshal.PtrToStructure(data, typeof(KeyboardEvent));
                    if (e.vk < 256) {
                        bool down = kind == 0x100 || kind == 0x104;
                        bool wasDown = Held((int)e.vk);
                        // The low-level event is delivered before its async key state changes.
                        // Refresh physical modifiers, then apply this event explicitly.
                        foreach (int key in new int[] { 0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0x5b, 0x5c })
                            keyState[key] = (byte)((GetAsyncKeyState(key) & 0x8000) != 0 ? 0x80 : 0);
                        byte toggle = (byte)(keyState[e.vk] & 1);
                        if ((e.vk == 0x14 || e.vk == 0x90) && down && !wasDown) toggle ^= 1;
                        keyState[e.vk] = (byte)((down ? 0x80 : 0) | toggle);
                        keyState[0x10] = (byte)(Held(0xa0) || Held(0xa1) ? 0x80 : 0);
                        keyState[0x11] = (byte)(Held(0xa2) || Held(0xa3) ? 0x80 : 0);
                        keyState[0x12] = (byte)(Held(0xa4) || Held(0xa5) ? 0x80 : 0);
                        if (down) {
                            IntPtr layout = GetKeyboardLayout(GetWindowThreadProcessId(GetForegroundWindow(), IntPtr.Zero));
                            int character = Translate(e.vk, e.scan, keyState, layout);
                            if (character >= 0) latest = character;
                        }
                    }
                }
            }
        } catch { /* Never interfere with the destination application. */ }
        return CallNextHookEx(hook, code, message, data);
    }
    private static void OnTimer(IntPtr window, uint message, UIntPtr timer, uint time) {
        if (latest >= 0) {
            int character = latest;
            latest = -1;
            Console.WriteLine("KEY:" + character);
        }
        if (parentId > 0 && clock.ElapsedMilliseconds >= nextParentCheck) {
            nextParentCheck = clock.ElapsedMilliseconds + 1000;
            try { using (Process parent = Process.GetProcessById(parentId)) { if (parent.HasExited) PostQuitMessage(0); } }
            catch { PostQuitMessage(0); }
        }
    }
    public static void Run(int parent) {
        parentId = parent;
        for (int key = 0; key < 256; key++) keyState[key] = (byte)((GetAsyncKeyState(key) & 0x8000) != 0 ? 0x80 : 0);
        keyState[0x14] |= (byte)(GetKeyState(0x14) & 1);
        keyState[0x90] |= (byte)(GetKeyState(0x90) & 1);
        hook = SetWindowsHookEx(13, hookCallback, GetModuleHandle(null), 0);
        if (hook == IntPtr.Zero) throw new InvalidOperationException("Could not initialize keyboard listener.");
        UIntPtr timer = SetTimer(IntPtr.Zero, UIntPtr.Zero, 10, timerCallback);
        if (timer == UIntPtr.Zero) { UnhookWindowsHookEx(hook); throw new InvalidOperationException("Could not initialize keyboard timer."); }
        clock.Start();
        Console.WriteLine("READY");
        try { Message message; while (GetMessage(out message, IntPtr.Zero, 0, 0) > 0) DispatchMessage(ref message); }
        finally { KillTimer(IntPtr.Zero, timer); UnhookWindowsHookEx(hook); latest = -1; }
    }
    // Deterministic native translation checks. No SendInput, foreground changes or keystrokes.
    public static void SelfTest() {
        IntPtr[] existingLayouts = new IntPtr[GetKeyboardLayoutList(0, null)];
        GetKeyboardLayoutList(existingLayouts.Length, existingLayouts);
        IntPtr layout = IntPtr.Zero;
        foreach (IntPtr candidate in existingLayouts)
            if ((candidate.ToInt64() & 0xffffffffL) == 0x04090409L) { layout = candidate; break; }
        bool loadedForTest = layout == IntPtr.Zero;
        if (loadedForTest) layout = LoadKeyboardLayout("00000409", 0x80); // KLF_NOTELLSHELL, no activation.
        if (layout == IntPtr.Zero) throw new InvalidOperationException("US test layout unavailable.");
        int count = 0;
        try {
            for (int mode = 0; mode < 4; mode++) {
                byte[] state = new byte[256];
                state[0x10] = (byte)((mode & 1) != 0 ? 0x80 : 0);
                state[0x14] = (byte)((mode & 2) != 0 ? 1 : 0);
                for (uint key = 0x41; key <= 0x5a; key++) {
                    int expected = ((mode == 1 || mode == 2) ? (int)key : (int)key + 32);
                    Verify(Translate(key, MapVirtualKeyEx(key, 0, layout), state, layout), expected); count++;
                }
            }
            string unshifted = "0123456789;=,-./`[\\]'";
            string shifted = ")!@#$%^&*(:+<_>?~{|}\"";
            uint[] keys = { 0x30,0x31,0x32,0x33,0x34,0x35,0x36,0x37,0x38,0x39,0xba,0xbb,0xbc,0xbd,0xbe,0xbf,0xc0,0xdb,0xdc,0xdd,0xde };
            for (int mode = 0; mode < 2; mode++) {
                byte[] state = new byte[256]; state[0x10] = (byte)(mode == 1 ? 0x80 : 0);
                for (int i = 0; i < keys.Length; i++) {
                    Verify(Translate(keys[i], MapVirtualKeyEx(keys[i], 0, layout), state, layout), mode == 1 ? shifted[i] : unshifted[i]); count++;
                }
                Verify(Translate(0x20, 0x39, state, layout), 32); count++;
            }
            foreach (int modifier in new int[] { 0x11, 0x12, 0x5b, 0x5c }) {
                byte[] state = new byte[256]; state[modifier] = 0x80;
                Verify(Translate(0x41, 0x1e, state, layout), -1); count++;
            }
            foreach (uint key in new uint[] { 0x08,0x09,0x0d,0x10,0x11,0x12,0x14,0x1b,0x25,0x2e,0x70,0x7b }) {
                Verify(Translate(key, MapVirtualKeyEx(key, 0, layout), new byte[256], layout), -1); count++;
            }
            byte[] numState = new byte[256]; numState[0x90] = 1;
            for (uint key = 0x60; key <= 0x69; key++) {
                Verify(Translate(key, MapVirtualKeyEx(key, 0, layout), numState, layout), (int)key - 0x60 + '0'); count++;
            }
            Console.WriteLine("SELFTEST:OK:" + count);
        } finally { if (loadedForTest) UnloadKeyboardLayout(layout); }
    }
    private static void Verify(int actual, int expected) {
        if (actual != expected) throw new InvalidOperationException("Native translation mismatch: " + actual + " != " + expected);
    }
}
'@
if ($SelfTest) { [PetTypedKeys]::SelfTest() } else { [PetTypedKeys]::Run($ParentProcessId) }
