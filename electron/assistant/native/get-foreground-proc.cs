using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
class GetForegroundProc {
  [DllImport("user32.dll")]
  static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  static void Main() {
    try {
      IntPtr hwnd = GetForegroundWindow();
      if (hwnd == IntPtr.Zero) { Console.Write(""); return; }
      uint pid;
      GetWindowThreadProcessId(hwnd, out pid);
      if (pid == 0) { Console.Write(""); return; }
      Process p = Process.GetProcessById((int)pid);
      // 输出 exe 文件名（不含路径），如 cmd.exe / WindowsTerminal.exe / pwsh.exe
      string name = p.ProcessName;
      if (string.IsNullOrEmpty(name)) { Console.Write(""); return; }
      Console.Write(name + ".exe");
    } catch {
      // 出错就静默；调用方拿到空串自己处理
      Console.Write("");
    }
  }
}
