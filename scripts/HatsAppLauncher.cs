using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

class HatsAppLauncher {
  [STAThread]
  static void Main() {
    string dir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
    string electron = Path.Combine(dir, "node_modules", "electron", "dist", "electron.exe");
    string ensure = Path.Combine(dir, "scripts", "ensure-electron.js");
    string node = FindNode();

    if (!File.Exists(electron)) {
      if (node == null || !File.Exists(ensure)) {
        MessageBox.Show("Electron is missing. Run npm install in the HatsApp folder first.", "HatsApp", MessageBoxButtons.OK, MessageBoxIcon.Error);
        return;
      }
      try {
        Process.Start(new ProcessStartInfo {
          FileName = node,
          Arguments = "\"" + ensure + "\"",
          WorkingDirectory = dir,
          UseShellExecute = false,
          CreateNoWindow = true
        }).WaitForExit();
      } catch (Exception ex) {
        MessageBox.Show("Failed to prepare Electron:\n" + ex.Message, "HatsApp", MessageBoxButtons.OK, MessageBoxIcon.Error);
        return;
      }
      if (!File.Exists(electron)) {
        MessageBox.Show("Electron is still missing after setup. Run npm install in the HatsApp folder.", "HatsApp", MessageBoxButtons.OK, MessageBoxIcon.Error);
        return;
      }
    }

    try {
      Process.Start(new ProcessStartInfo {
        FileName = electron,
        Arguments = ".",
        WorkingDirectory = dir,
        UseShellExecute = false
      });
    } catch (Exception ex) {
      MessageBox.Show("Failed to start HatsApp:\n" + ex.Message, "HatsApp", MessageBoxButtons.OK, MessageBoxIcon.Error);
    }
  }

  static string FindNode() {
    string pathEnv = Environment.GetEnvironmentVariable("PATH") ?? "";
    foreach (string part in pathEnv.Split(Path.PathSeparator)) {
      try {
        string candidate = Path.Combine(part.Trim('"'), "node.exe");
        if (File.Exists(candidate)) return candidate;
      } catch {}
    }
    string[] extras = {
      Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe"),
      Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "nodejs", "node.exe")
    };
    foreach (string candidate in extras) {
      if (File.Exists(candidate)) return candidate;
    }
    return null;
  }
}
