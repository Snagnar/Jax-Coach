// Jax Coach Setup: a small per-user installer (no admin rights needed).
// The app files travel inside the exe as app.zip (see build.ps1). Setup copies them, adds the shortcuts and an
// "Apps & features" entry, and optionally runs voice\setup-voice.ps1 for the local voice.
// Written for the C# 5 compiler that ships with Windows (.NET Framework 4.x), so build.ps1 needs no SDK.
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Management;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("Jax Coach Setup")]
[assembly: AssemblyProduct("Jax Coach")]
[assembly: AssemblyDescription("Installs Jax Coach, a local coaching app for top lane in League of Legends")]

namespace JaxCoachSetup
{
    static class Program
    {
        [STAThread]
        static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new SetupForm(Environment.GetCommandLineArgs()));
        }
    }

    class SetupForm : Form
    {
        const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\JaxCoach";
        static readonly Color Brand = Color.FromArgb(38, 28, 74);
        static readonly Color Accent = Color.FromArgb(190, 168, 255);

        readonly string version;
        TextBox dir, log;
        CheckBox voice, claude, desktop, launch;
        Button browse, install, close;
        ProgressBar bar;
        Label status;
        Process child;
        bool busy, finished, claudeAsked;
        string installedRoot;

        // Command line (all optional): /dir="C:\Games\Jax Coach" /novoice /noclaude /nodesktop /nolaunch /auto (start right away)
        public SetupForm(string[] args)
        {
            version = ReadText("version.txt").Trim();
            SuspendLayout();
            AutoScaleDimensions = new SizeF(96F, 96F);
            AutoScaleMode = AutoScaleMode.Dpi;
            Text = "Jax Coach Setup";
            Font = new Font("Segoe UI", 9F);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(560, 526);
            BackColor = Color.White;
            using (var s = Res("icon.ico")) Icon = new Icon(s);

            var header = new Panel { Location = new Point(0, 0), Size = new Size(560, 84), BackColor = Brand };
            var logo = new PictureBox { Location = new Point(18, 14), Size = new Size(56, 56), SizeMode = PictureBoxSizeMode.Zoom };
            using (var s = Res("icon.ico")) logo.Image = new Icon(s, 64, 64).ToBitmap();
            var title = new Label { Text = "Jax Coach", ForeColor = Color.White, Font = new Font("Segoe UI Semibold", 17F), Location = new Point(84, 14), AutoSize = true };
            var sub = new Label { Text = "Live coaching for top lane  ·  version " + version, ForeColor = Accent, Location = new Point(87, 50), AutoSize = true };
            header.Controls.AddRange(new Control[] { logo, title, sub });

            var dirLabel = new Label { Text = "Install folder (no admin rights needed):", Location = new Point(16, 100), AutoSize = true };
            dir = new TextBox { Location = new Point(16, 122), Size = new Size(430, 24), Text = DefaultRoot() };
            browse = new Button { Text = "Browse…", Location = new Point(454, 120), Size = new Size(90, 28) };
            browse.Click += delegate { PickFolder(); };

            voice = new CheckBox { Text = "Local voice (Kokoro): natural offline voice for the callouts. Downloads about 420 MB.", Location = new Point(16, 158), Size = new Size(530, 24), Checked = true };
            bool hasClaude = ClaudeInstalled();
            claude = new CheckBox { Text = hasClaude ? "Claude Code (AI research agents): already installed" : "Claude Code (AI research agents: game plans, new champions). Anthropic's official installer.", Location = new Point(16, 184), Size = new Size(530, 24), Checked = !hasClaude, Enabled = !hasClaude };
            desktop = new CheckBox { Text = "Desktop shortcut (the Start menu entry is always added)", Location = new Point(16, 210), Size = new Size(530, 24), Checked = true };
            launch = new CheckBox { Text = "Start Jax Coach when setup is done", Location = new Point(16, 236), Size = new Size(530, 24), Checked = true };

            status = new Label { Text = "Ready to install.", Location = new Point(16, 272), Size = new Size(530, 20) };
            bar = new ProgressBar { Location = new Point(16, 294), Size = new Size(528, 16), Maximum = 100 };
            log = new TextBox
            {
                Location = new Point(16, 320), Size = new Size(528, 150), Multiline = true, ReadOnly = true,
                ScrollBars = ScrollBars.Vertical, Font = new Font("Consolas", 8.5F), BackColor = Color.FromArgb(247, 246, 251)
            };

            install = new Button { Text = "Install", Location = new Point(348, 482), Size = new Size(96, 30) };
            close = new Button { Text = "Cancel", Location = new Point(452, 482), Size = new Size(92, 30) };
            install.Click += delegate { OnInstall(); };
            close.Click += delegate { Close(); };
            AcceptButton = install;

            Controls.AddRange(new Control[] { header, dirLabel, dir, browse, voice, claude, desktop, launch, status, bar, log, install, close });
            FormClosing += OnClosing;

            ResumeLayout(false);     // applies the DPI scaling to everything above

            bool auto = false;
            foreach (var a in args)
            {
                string arg = a.ToLowerInvariant();
                if (arg.StartsWith("/dir=")) dir.Text = a.Substring(5).Trim('"');
                else if (arg == "/novoice") voice.Checked = false;
                else if (arg == "/noclaude") claude.Checked = false;
                else if (arg == "/nodesktop") desktop.Checked = false;
                else if (arg == "/nolaunch") launch.Checked = false;
                else if (arg == "/auto") auto = true;
            }
            if (auto) Shown += delegate { OnInstall(); };

            string existing = RegisteredRoot();
            if (existing != null) Log("Jax Coach is already installed in " + existing + ". Installing again updates it; your settings and history stay.");
        }

        // ---------- UI ----------

        static bool ClaudeInstalled()
        {
            string home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            if (File.Exists(Path.Combine(home, @".local\bin\claude.exe"))) return true;
            foreach (var d in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';'))
            {
                try { if (d.Length > 0 && (File.Exists(Path.Combine(d, "claude.exe")) || File.Exists(Path.Combine(d, "claude.cmd")))) return true; } catch { }
            }
            return false;
        }

        static string DefaultRoot()
        {
            return RegisteredRoot() ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Programs\Jax Coach");
        }

        static string RegisteredRoot()
        {
            using (var k = Registry.CurrentUser.OpenSubKey(UninstallKey))
            {
                var v = k == null ? null : k.GetValue("InstallLocation") as string;
                return string.IsNullOrEmpty(v) ? null : v;
            }
        }

        void PickFolder()
        {
            using (var d = new FolderBrowserDialog { Description = "Where should Jax Coach go? A \"Jax Coach\" folder is made inside it." })
            {
                if (d.ShowDialog(this) != DialogResult.OK) return;
                var p = d.SelectedPath;
                dir.Text = Path.GetFileName(p.TrimEnd('\\')).Equals("Jax Coach", StringComparison.OrdinalIgnoreCase) ? p : Path.Combine(p, "Jax Coach");
            }
        }

        void Log(string line)
        {
            if (InvokeRequired) { BeginInvoke(new Action<string>(Log), line); return; }
            log.AppendText(line + Environment.NewLine);
        }

        void Status(string text, int progress)
        {
            if (InvokeRequired) { BeginInvoke(new Action<string, int>(Status), text, progress); return; }
            if (text != null) status.Text = text;
            if (progress >= 0) bar.Value = Math.Max(0, Math.Min(100, progress));
        }

        void OnInstall()
        {
            if (finished) { StartApp(); Close(); return; }
            string root;
            try { root = Path.GetFullPath(dir.Text.Trim()); }
            catch { MessageBox.Show(this, "That folder path isn't valid.", Text); return; }

            if (RunningFrom(root))
            {
                MessageBox.Show(this, "Jax Coach is running from this folder. Quit it first (right-click the lamp icon in the tray > Quit Jax Coach), then click Install again.", Text, MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }

            busy = true;
            install.Enabled = browse.Enabled = dir.Enabled = voice.Enabled = claude.Enabled = desktop.Enabled = launch.Enabled = false;
            bool wantVoice = voice.Checked, wantClaude = claude.Checked && claude.Enabled, wantDesktop = desktop.Checked;
            claudeAsked = wantClaude;
            var t = new Thread(delegate () { Run(root, wantVoice, wantClaude, wantDesktop); }) { IsBackground = true };
            t.Start();
        }

        void OnClosing(object sender, FormClosingEventArgs e)
        {
            if (!busy) return;
            if (MessageBox.Show(this, "Setup is still running. Stop it?", Text, MessageBoxButtons.YesNo, MessageBoxIcon.Warning) != DialogResult.Yes) { e.Cancel = true; return; }
            try { if (child != null && !child.HasExited) child.Kill(); } catch { }
        }

        void Done(bool ok, string message)
        {
            if (InvokeRequired) { BeginInvoke(new Action<bool, string>(Done), ok, message); return; }
            busy = false;
            Status(message, ok ? 100 : -1);
            if (!ok) { install.Text = "Retry"; install.Enabled = browse.Enabled = dir.Enabled = voice.Enabled = desktop.Enabled = launch.Enabled = true; claude.Enabled = claudeAsked; close.Text = "Close"; return; }
            finished = true;
            close.Text = "Close";
            if (launch.Checked) { StartApp(); install.Text = "Open again"; }
            else install.Text = "Start Jax Coach";
            install.Enabled = true;
        }

        void StartApp()
        {
            if (installedRoot == null) return;
            Process.Start(new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "wscript.exe"), Quote(Path.Combine(installedRoot, "Jax Coach.vbs"))) { UseShellExecute = false });
        }

        // ---------- install ----------

        void Run(string root, bool wantVoice, bool wantClaude, bool wantDesktop)
        {
            try
            {
                Status("Copying files…", 2);
                Directory.CreateDirectory(root);
                string full = root.TrimEnd('\\') + "\\";
                int n = 0;
                using (var zs = Res("app.zip"))
                using (var zip = new ZipArchive(zs, ZipArchiveMode.Read))
                {
                    foreach (var e in zip.Entries)
                    {
                        string dest = Path.GetFullPath(Path.Combine(root, e.FullName.Replace('/', '\\')));
                        if (!dest.StartsWith(full, StringComparison.OrdinalIgnoreCase)) continue;   // never write outside the folder
                        if (e.FullName.EndsWith("/")) { Directory.CreateDirectory(dest); continue; }
                        Directory.CreateDirectory(Path.GetDirectoryName(dest));
                        e.ExtractToFile(dest, true);
                        n++;
                    }
                }
                installedRoot = root;
                Log(n + " files copied to " + root);

                Status("Adding shortcuts…", 10);
                int code = RunPowerShell(Path.Combine(root, @"app\create-shortcut.ps1"), wantDesktop ? "" : "-NoDesktop", null);
                if (code != 0) Log("The shortcuts could not be made (exit code " + code + "). Run \"Create desktop shortcut.bat\" in the install folder.");
                Register(root);
                Log("Added to Windows Settings > Apps (uninstall from there).");
                Status(null, 15);

                string claudeNote = "";
                if (wantClaude)
                {
                    Status("Installing Claude Code…", 16);
                    code = RunPowerShell(Path.Combine(root, @"agents\setup-claude.ps1"), "", null);
                    claudeNote = code == 0 ? " Sign in to Claude once in the app (Playbook tab)." : " Claude Code could not be installed; see the log.";
                }
                string voiceNote = "";
                if (wantVoice)
                {
                    Status("Setting up the local voice (this can take a few minutes)…", 16);
                    code = RunPowerShell(Path.Combine(root, @"voice\setup-voice.ps1"), "", delegate (int p) { Status(null, 16 + p * 84 / 100); });
                    if (code != 0) voiceNote = " The local voice failed; run \"Install local voice.bat\" later. Jax Coach falls back to Windows voices.";
                }
                Log("Done.");
                Done(true, "Jax Coach is installed." + voiceNote + claudeNote);
            }
            catch (Exception ex)
            {
                Log("Error: " + ex.Message);
                Done(false, "Setup failed: " + ex.Message);
            }
        }

        int RunPowerShell(string script, string args, Action<int> onProgress)
        {
            var psi = new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, @"WindowsPowerShell\v1.0\powershell.exe"),
                "-NoProfile -ExecutionPolicy Bypass -File " + Quote(script) + " " + args)
            {
                UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true,
                WorkingDirectory = Path.GetDirectoryName(script)
            };
            using (var p = new Process { StartInfo = psi })
            {
                DataReceivedEventHandler h = delegate (object s, DataReceivedEventArgs e)
                {
                    if (e.Data == null) return;
                    string line = e.Data.TrimEnd();
                    int pct;
                    if (line.StartsWith("PROGRESS ") && int.TryParse(line.Substring(9), out pct)) { if (onProgress != null) onProgress(pct); }
                    else if (line.StartsWith("STEP ")) { Status(line.Substring(5), -1); Log(line.Substring(5)); }
                    else if (line.Length > 0) Log("  " + line);
                };
                p.OutputDataReceived += h;
                p.ErrorDataReceived += h;
                p.Start();
                child = p;
                p.BeginOutputReadLine();
                p.BeginErrorReadLine();
                p.WaitForExit();
                child = null;
                return p.ExitCode;
            }
        }

        void Register(string root)
        {
            using (var k = Registry.CurrentUser.CreateSubKey(UninstallKey))
            {
                k.SetValue("DisplayName", "Jax Coach");
                k.SetValue("DisplayVersion", version);
                k.SetValue("Publisher", "Jax Coach");
                k.SetValue("DisplayIcon", Path.Combine(root, @"app\jax-coach.ico"));
                k.SetValue("InstallLocation", root);
                k.SetValue("UninstallString", "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " + Quote(Path.Combine(root, @"app\uninstall.ps1")));
                k.SetValue("NoModify", 1, RegistryValueKind.DWord);
                k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                k.SetValue("EstimatedSize", 600 * 1024, RegistryValueKind.DWord);   // KB, with the local voice
            }
        }

        // ---------- helpers ----------

        // the tray app, server and voice helper all have the install folder in their command line
        static bool RunningFrom(string root)
        {
            string needle = root.TrimEnd('\\') + "\\";
            try
            {
                using (var q = new ManagementObjectSearcher("SELECT CommandLine FROM Win32_Process WHERE Name='powershell.exe' OR Name='pythonw.exe' OR Name='python.exe'"))
                    foreach (ManagementObject o in q.Get())
                    {
                        var c = o["CommandLine"] as string;
                        if (c != null && c.IndexOf(needle, StringComparison.OrdinalIgnoreCase) >= 0) return true;
                    }
            }
            catch { }
            return false;
        }

        static string Quote(string s) { return "\"" + s + "\""; }

        static Stream Res(string name)
        {
            var s = Assembly.GetExecutingAssembly().GetManifestResourceStream(name);
            if (s == null) throw new InvalidOperationException("Missing resource " + name);
            return s;
        }

        static string ReadText(string name)
        {
            using (var r = new StreamReader(Res(name), Encoding.UTF8)) return r.ReadToEnd();
        }
    }
}
