using System;
using System.Runtime.InteropServices;
using System.Threading;
class CopySelection {
  [DllImport("user32.dll")]
  static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, IntPtr dwExtraInfo);
  static void Main() {
    byte VK_CTRL = 0x11, VK_C = 0x43;
    keybd_event(VK_CTRL, 0, 0, IntPtr.Zero);
    keybd_event(VK_C, 0, 0, IntPtr.Zero);
    Thread.Sleep(30);
    keybd_event(VK_C, 0, 2, IntPtr.Zero);
    keybd_event(VK_CTRL, 0, 2, IntPtr.Zero);
    Thread.Sleep(80);
  }
}
