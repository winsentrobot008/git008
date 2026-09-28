using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Net.Sockets;
using System.Net;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;
using System.Windows.Forms;
namespace AIFactory
{
    public class MainForm : Form
    {
        private Label lblGateway;
        private Label lblModel;
        private Label lblHosts;
        private Label lblModelInfo;
        private Label lblThroughput;
        private Button btnStartLocal;
        private Button btnStopLocal;
        private Button btnRestartGateway;
        private Timer timer;
        private int metricsPollInProgress;
        private long cumulativeTokens;
        private long totalRequests;
        private long previousMetricTokens = -1;
        private DateTime previousMetricTime = DateTime.MinValue;
        private static readonly string RepoRoot = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, ".."));
        private static readonly string ServerPath = Environment.GetEnvironmentVariable("LOCAL_MODEL_SERVER_PATH") ?? @"D:\ai_models\bin\llama-server.exe";
        private static readonly string ModelPath = Environment.GetEnvironmentVariable("LOCAL_MODEL_PATH") ?? @"D:\ai_models\Ternary-Bonsai-2-27B\Ternary-Bonsai-2-27B-PTQ1_0.gguf";
        private static readonly string GatewayScript = Path.Combine(RepoRoot, "gateway.ps1");
        private static readonly string ModelCacheScript = Path.Combine(RepoRoot, "scripts", "ssd_model_cache.ps1");
        private static readonly string HostsPath = Path.Combine(Environment.GetEnvironmentVariable("SystemRoot") ?? "", "System32", "drivers", "etc", "hosts");
        // 修复①：Codex 全局配置在【当前用户家目录】，写 RepoRoot\.codex\config.toml 不会生效。
        private static readonly string CodexConfigPath = Environment.GetEnvironmentVariable("CODEX_CONFIG_PATH") ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".codex", "config.toml");
        // 修复③：VS Code 全局用户设置，用于关闭 http.proxySupport，避免代理层拦截本地网关请求。
        private static readonly string VsCodeSettingsPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Code", "User", "settings.json");
        // 修复②：兼容 base_url 与 api_base 两种写法。
        private const string BaseUrlPattern = @"(?m)^(\s*(?:base_url|api_base)\s*=\s*)[""'][^""']*[""']";
        private const string LocalBaseUrl = "http://127.0.0.1:8000/v1";
        private const string CloudBaseUrl = "https://api.deepseek.com/v1";
        private string statusNotice = "";
        public MainForm()
        {
            this.Text = "🤖 AI 工厂控制面板";
            this.ClientSize = new Size(584, 660);
            this.FormBorderStyle = FormBorderStyle.FixedDialog;
            this.MaximizeBox = false;
            this.StartPosition = FormStartPosition.CenterScreen;
            Label lblTitle = new Label();
            lblTitle.Text = "AI 工厂算力与流量控制器";
            lblTitle.Font = new Font("Microsoft YaHei", 14, FontStyle.Bold);
            lblTitle.ForeColor = Color.FromArgb(30, 136, 229);
            lblTitle.Location = new Point(20, 15);
            lblTitle.AutoSize = true;
            this.Controls.Add(lblTitle);
            GroupBox grpStatus = new GroupBox();
            grpStatus.Text = " 实时服务状态监测 ";
            grpStatus.Font = new Font("Microsoft YaHei", 10);
            grpStatus.Location = new Point(20, 50);
            grpStatus.Size = new Size(544, 110);
            lblGateway = new Label();
            lblGateway.Location = new Point(15, 25);
            lblGateway.AutoSize = true;
            lblGateway.Font = new Font("Microsoft YaHei", 9);
            lblModel = new Label();
            lblModel.Location = new Point(15, 50);
            lblModel.AutoSize = true;
            lblModel.Font = new Font("Microsoft YaHei", 9);
            lblHosts = new Label();
            lblHosts.Location = new Point(15, 75);
            lblHosts.AutoSize = true;
            lblHosts.Font = new Font("Microsoft YaHei", 9);
            grpStatus.Controls.Add(lblGateway);
            grpStatus.Controls.Add(lblModel);
            grpStatus.Controls.Add(lblHosts);
            this.Controls.Add(grpStatus);

            GroupBox grpModelInfo = new GroupBox();
            grpModelInfo.Text = " 模型与硬件参数 ";
            grpModelInfo.Font = new Font("Microsoft YaHei", 10);
            grpModelInfo.Location = new Point(20, 170);
            grpModelInfo.Size = new Size(544, 100);
            lblModelInfo = new Label();
            lblModelInfo.Location = new Point(15, 28);
            lblModelInfo.AutoSize = true;
            lblModelInfo.MaximumSize = new Size(510, 0);
            lblModelInfo.Font = new Font("Microsoft YaHei", 9);
            lblModelInfo.Text = "当前模型：27B (PTQ1_0)    上下文限制：32,768 Tokens\n路由接口：http://127.0.0.1:8000/v1";
            grpModelInfo.Controls.Add(lblModelInfo);
            this.Controls.Add(grpModelInfo);

            GroupBox grpThroughput = new GroupBox();
            grpThroughput.Text = " 实时吞吐监控 ";
            grpThroughput.Font = new Font("Microsoft YaHei", 10);
            grpThroughput.Location = new Point(20, 280);
            grpThroughput.Size = new Size(544, 115);
            lblThroughput = new Label();
            lblThroughput.Location = new Point(15, 28);
            lblThroughput.AutoSize = true;
            lblThroughput.Font = new Font("Microsoft YaHei", 9);
            lblThroughput.Text = "输出速度：等待服务上线\n显存占用：等待服务上线\n累计生成：0 Tokens    总请求：0";
            grpThroughput.Controls.Add(lblThroughput);
            this.Controls.Add(grpThroughput);

            btnStartLocal = new Button();
            btnStartLocal.Text = "🚀 开启【本地全效模式】\n(启动 27B + 挂载显存 + 锁定本地流量)";
            btnStartLocal.Font = new Font("Microsoft YaHei", 10, FontStyle.Bold);
            btnStartLocal.BackColor = Color.FromArgb(46, 125, 50);
            btnStartLocal.ForeColor = Color.White;
            btnStartLocal.FlatStyle = FlatStyle.Flat;
            btnStartLocal.Location = new Point(20, 410);
            btnStartLocal.Size = new Size(544, 65);
            btnStartLocal.FlatAppearance.BorderSize = 0;
            btnStartLocal.Click += BtnStartLocal_Click;
            this.Controls.Add(btnStartLocal);
            btnStopLocal = new Button();
            btnStopLocal.Text = "🛑 恢复【云端回退模式】\n(关闭模型释放显存 + 恢复云端路由)";
            btnStopLocal.Font = new Font("Microsoft YaHei", 10, FontStyle.Bold);
            btnStopLocal.BackColor = Color.FromArgb(198, 40, 40);
            btnStopLocal.ForeColor = Color.White;
            btnStopLocal.FlatStyle = FlatStyle.Flat;
            btnStopLocal.Location = new Point(20, 490);
            btnStopLocal.Size = new Size(544, 65);
            btnStopLocal.FlatAppearance.BorderSize = 0;
            btnStopLocal.Click += BtnStopLocal_Click;
            this.Controls.Add(btnStopLocal);
            btnRestartGateway = new Button();
            btnRestartGateway.Text = "🔄 重启路由网关\n(清理 8000 端口占用 + 重新加载 gateway.ps1)";
            btnRestartGateway.Font = new Font("Microsoft YaHei", 10, FontStyle.Bold);
            btnRestartGateway.BackColor = Color.FromArgb(2, 119, 189);
            btnRestartGateway.ForeColor = Color.White;
            btnRestartGateway.FlatStyle = FlatStyle.Flat;
            btnRestartGateway.Location = new Point(20, 570);
            btnRestartGateway.Size = new Size(544, 65);
            btnRestartGateway.FlatAppearance.BorderSize = 0;
            btnRestartGateway.Click += BtnRestartGateway_Click;
            this.Controls.Add(btnRestartGateway);
            timer = new Timer();
            timer.Interval = 2000;
            timer.Tick += Timer_Tick;
            timer.Start();
            RefreshStatus();
            PollMetricsInBackground();
            this.FormClosing += MainForm_FormClosing;
        }
        private void Timer_Tick(object sender, EventArgs e)
        {
            RefreshStatus();
            PollMetricsInBackground();
        }

        private void PollMetricsInBackground()
        {
            if (System.Threading.Interlocked.Exchange(ref metricsPollInProgress, 1) != 0) return;
            System.Threading.ThreadPool.QueueUserWorkItem(delegate
            {
                string gatewayData = null;
                try { gatewayData = ReadEndpoint("http://127.0.0.1:8000/stats"); }
                catch
                {
                    try { gatewayData = ReadEndpoint("http://127.0.0.1:8000/metrics"); }
                    catch { }
                }

                double? tokensPerSecond = ParseMetric(gatewayData, "tokens_per_second|generation_tps|tokens_predicted_per_second|eval_rate|tokens_per_sec");
                long? parsedTokens = ParseCounter(gatewayData, "llamacpp:tokens_predicted_total|tokens_predicted_total|generated_tokens|completion_tokens_total|tokens_generated|total_tokens");
                long? parsedRequests = ParseCounter(gatewayData, "llamacpp:requests_total|requests_total|total_requests|request_count|requests_count");
                if (!tokensPerSecond.HasValue && parsedTokens.HasValue && previousMetricTokens >= 0)
                {
                    double seconds = (DateTime.UtcNow - previousMetricTime).TotalSeconds;
                    if (seconds > 0 && parsedTokens.Value >= previousMetricTokens)
                        tokensPerSecond = (parsedTokens.Value - previousMetricTokens) / seconds;
                }
                if (parsedTokens.HasValue) { previousMetricTokens = parsedTokens.Value; previousMetricTime = DateTime.UtcNow; }
                string gpuText = ReadGpuMemory();

                if (!String.IsNullOrEmpty(gatewayData))
                {
                    if (parsedTokens.HasValue) cumulativeTokens = parsedTokens.Value;
                    if (parsedRequests.HasValue) totalRequests = parsedRequests.Value;
                }
                try
                {
                    if (!IsDisposed && IsHandleCreated)
                        BeginInvoke((Action)delegate
                        {
                            if (String.IsNullOrEmpty(gatewayData))
                                lblThroughput.Text = "输出速度：等待服务上线\n显存占用：" + gpuText + "\n累计生成：" + cumulativeTokens + " Tokens    总请求：" + totalRequests;
                            else
                                lblThroughput.Text = "输出速度：" + (tokensPerSecond.HasValue ? tokensPerSecond.Value.ToString("0.0") + " Tokens/s" : "暂无数据") +
                                    "\n显存占用：" + gpuText + "\n累计生成：" + cumulativeTokens + " Tokens    总请求：" + totalRequests;
                        });
                }
                catch (InvalidOperationException) { }
                finally { System.Threading.Interlocked.Exchange(ref metricsPollInProgress, 0); }
            });
        }

        private static string ReadEndpoint(string url)
        {
            var request = (HttpWebRequest)WebRequest.Create(url);
            request.Method = "GET";
            request.Timeout = 1000;
            request.ReadWriteTimeout = 1000;
            using (var response = (HttpWebResponse)request.GetResponse())
            using (var reader = new StreamReader(response.GetResponseStream())) return reader.ReadToEnd();
        }

        private static double? ParseMetric(string data, string names)
        {
            if (String.IsNullOrEmpty(data)) return null;
            var match = Regex.Match(data, "(?:\\\"(?:" + names + ")\\\"\\s*:\\s*|(?:" + names + ")(?:\\{[^}]*\\})?\\s+)([0-9]+(?:\\.[0-9]+)?)", RegexOptions.IgnoreCase);
            double value;
            return match.Success && Double.TryParse(match.Groups[1].Value, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out value) ? (double?)value : null;
        }

        private static long? ParseCounter(string data, string names)
        {
            double? value = ParseMetric(data, names);
            return value.HasValue ? (long?)value.Value : null;
        }

        private static string ReadGpuMemory()
        {
            try
            {
                var psi = new ProcessStartInfo("nvidia-smi", "--query-gpu=memory.used,memory.total --format=csv,noheader,nounits")
                { CreateNoWindow = true, UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true };
                using (var process = Process.Start(psi))
                {
                    if (!process.WaitForExit(1000)) { process.Kill(); return "读取超时"; }
                    var match = Regex.Match(process.StandardOutput.ReadToEnd(), @"(\d+)\s*,\s*(\d+)");
                    return match.Success ? match.Groups[1].Value + " / " + match.Groups[2].Value + " MiB" : "不可用";
                }
            }
            catch { return "不可用"; }
        }
        private bool IsPortListening(int port)
        {
            try
            {
                using (var client = new TcpClient())
                {
                    var result = client.BeginConnect("127.0.0.1", port, null, null);
                    bool success = result.AsyncWaitHandle.WaitOne(300);
                    if (success && client.Connected)
                    {
                        client.EndConnect(result);
                        return true;
                    }
                    return false;
                }
            }
            catch { return false; }
        }
        private bool IsHostsIntercepted()
        {
            if (!File.Exists(HostsPath)) return false;
            try
            {
                string content = File.ReadAllText(HostsPath);
                return Regex.IsMatch(content, @"127\.0\.0\.1\s+api\.openai\.com");
            }
            catch { return false; }
        }
        // 修复④：写 Hosts 需要管理员权限——先探测权限，把"静默失败"变成明确提示。
        private static bool IsAdministrator()
        {
            try
            {
                using (WindowsIdentity identity = WindowsIdentity.GetCurrent())
                    return new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);
            }
            catch { return false; }
        }

        private bool ReportHostsPermissionIssue(string detail, bool interactive)
        {
            SetNotice("⚠ 需要管理员权限：无法修改 Hosts 流量锁定。" + (String.IsNullOrWhiteSpace(detail) ? "" : "（" + detail + "）"));
            if (interactive && !IsDisposed && IsHandleCreated)
                MessageBox.Show(this,
                    "需要管理员权限。\n\n修改 C:\\Windows\\System32\\drivers\\etc\\hosts 必须提升权限，请关闭面板后以“以管理员身份运行”重新打开。"
                        + (String.IsNullOrWhiteSpace(detail) ? "" : "\n\n系统返回：" + detail),
                    "需要管理员权限", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return false;
        }

        // Hosts 常被安全软件置为只读，写入前先清掉只读位（同样需要管理员权限）。
        private static void ClearHostsReadOnlyAttribute()
        {
            try
            {
                FileAttributes attributes = File.GetAttributes(HostsPath);
                if ((attributes & FileAttributes.ReadOnly) == FileAttributes.ReadOnly)
                    File.SetAttributes(HostsPath, attributes & ~FileAttributes.ReadOnly);
            }
            catch (Exception ex) { System.Diagnostics.Debug.WriteLine("清除 Hosts 只读属性失败：" + ex.Message); }
        }

        private bool SetHostsState(bool enable, bool interactive = false)
        {
            if (!IsAdministrator()) return ReportHostsPermissionIssue("当前进程未以管理员身份运行", interactive);
            try
            {
                if (!File.Exists(HostsPath))
                {
                    SetNotice("⚠ 未找到 Hosts 文件，已跳过流量锁定。");
                    return false;
                }
                string content = File.ReadAllText(HostsPath);
                bool isIntercepted = Regex.IsMatch(content, @"127\.0\.0\.1\s+api\.openai\.com");
                if (enable && !isIntercepted)
                {
                    ClearHostsReadOnlyAttribute();
                    File.AppendAllText(HostsPath, "\n127.0.0.1 api.openai.com\n");
                    FlushDns();
                }
                else if (!enable && isIntercepted)
                {
                    ClearHostsReadOnlyAttribute();
                    var lines = File.ReadAllLines(HostsPath)
                                    .Where(line => !Regex.IsMatch(line, @"127\.0\.0\.1\s+api\.openai\.com"))
                                    .ToArray();
                    File.WriteAllLines(HostsPath, lines);
                    FlushDns();
                }
                return true;
            }
            catch (UnauthorizedAccessException ex)
            {
                return ReportHostsPermissionIssue(ex.Message, interactive);
            }
            catch (Exception ex)
            {
                SetNotice("⚠ 修改 Hosts 失败：" + ex.Message);
                return false;
            }
        }
        private void FlushDns()
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo("ipconfig", "/flushdns");
                psi.CreateNoWindow = true;
                psi.UseShellExecute = false;
                Process.Start(psi);
            }
            catch { }
        }
        private bool EnsureGatewayRunning()
        {
            if (IsPortListening(8000)) return true;
            if (!File.Exists(GatewayScript))
            {
                SetNotice("⚠ 未找到网关脚本 " + GatewayScript + "，网关未启动。");
                return false;
            }
            ProcessStartInfo psi = new ProcessStartInfo("powershell", "-ExecutionPolicy Bypass -WindowStyle Hidden -File \"" + GatewayScript + "\"");
            psi.CreateNoWindow = true;
            psi.UseShellExecute = false;
            try { Process.Start(psi); return true; }
            catch (Exception ex) { SetNotice("⚠ 网关启动失败：" + ex.Message); return false; }
        }
        // 用 -EncodedCommand 传脚本，避免引号/中文在命令行被二次解析。
        private static string RunPowerShell(string script, int timeoutMs)
        {
            try
            {
                var psi = new ProcessStartInfo("powershell.exe",
                    "-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand " + Convert.ToBase64String(Encoding.Unicode.GetBytes(script)));
                psi.CreateNoWindow = true;
                psi.UseShellExecute = false;
                psi.RedirectStandardOutput = true;
                psi.RedirectStandardError = true;
                using (var process = Process.Start(psi))
                {
                    if (!process.WaitForExit(timeoutMs)) { try { process.Kill(); } catch { } return null; }
                    string stdout = process.StandardOutput.ReadToEnd();
                    process.StandardError.ReadToEnd();
                    return stdout.Trim();
                }
            }
            catch { return null; }
        }

        // 动态定位端口宿主：HttpListener 经内核 http.sys 绑定，端口扫描只能看到 PID 4，
        // 因此再按命令行匹配 gateway.ps1 兜底；PID 0/4 与本进程永不参与。
        private static int[] ResolvePortOwnerPids(int port)
        {
            int selfPid = Process.GetCurrentProcess().Id;
            var pids = new System.Collections.Generic.List<int>();
            CollectPids(pids, RunPowerShell("@(Get-NetTCPConnection -LocalPort " + port + " -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique) -join ','", 15000), selfPid);
            if (pids.Count == 0)
                CollectPids(pids, RunPowerShell("@(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq 'powershell.exe' -and $_.ProcessId -ne $PID -and $_.ProcessId -ne " + selfPid + " -and $_.CommandLine -like '*gateway.ps1*' } | Select-Object -ExpandProperty ProcessId -Unique) -join ','", 20000), selfPid);
            if (pids.Count == 0)
                CollectPids(pids, RunPowerShell("$lines = @(netsh http show servicestate view=requestq 2>$null) -split '[\\r\\n]+'; $idx = -1; for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i] -like '*127.0.0.1:" + port + "*') { $idx = $i; break } } if ($idx -ge 0) { $lo = [Math]::Max(0, $idx - 30); for ($j = $idx; $j -ge $lo; $j--) { if (($lines[$j] -like '*.exe*') -and ($lines[$j] -like '*powershell.exe*')) { $hit = [regex]::Match($lines[$j], '\\d+'); if ($hit.Success) { $hit.Value; break } } } }", 20000), selfPid);
            return pids.ToArray();
        }

        private static void CollectPids(System.Collections.Generic.List<int> pids, string text, int selfPid)
        {
            if (String.IsNullOrEmpty(text)) return;
            foreach (string token in text.Split(','))
            {
                int pid;
                if (Int32.TryParse(token.Trim(), out pid) && pid > 4 && pid != selfPid && !pids.Contains(pid)) pids.Add(pid);
            }
        }

        // 清场：杀掉占用端口的旧进程并等待端口真正释放，保证随后启动的一定是最新 gateway.ps1。
        private bool ClearGatewayPort()
        {
            int[] pids = ResolvePortOwnerPids(8000);
            if (pids.Length == 0)
            {
                if (IsPortListening(8000)) SetNotice("⚠ 8000 端口被占用，但无法定位其宿主进程。");
                return !IsPortListening(8000);
            }
            var pidList = new StringBuilder();
            foreach (int pid in pids)
            {
                if (pidList.Length > 0) pidList.Append(',');
                pidList.Append(pid);
            }
            RunPowerShell("Stop-Process -Id " + pidList + " -Force -ErrorAction SilentlyContinue", 20000);
            return WaitForPort(8000, false, 10);
        }

        private bool WaitForPort(int port, bool shouldListen, int timeoutSeconds)
        {
            DateTime deadline = DateTime.UtcNow.AddSeconds(timeoutSeconds);
            while (IsPortListening(port) != shouldListen && DateTime.UtcNow < deadline) System.Threading.Thread.Sleep(200);
            return IsPortListening(port) == shouldListen;
        }

        private void RefreshStatus()
        {
            bool gwAlive = IsPortListening(8000);
            bool modelAlive = IsPortListening(8080);
            bool hostsIntercept = IsHostsIntercepted();
            lblGateway.Text = "🌐 路由网关 [8000]: " + (gwAlive ? "🟢 在线运行" : "🔴 未运行");
            lblGateway.ForeColor = gwAlive ? Color.Green : Color.Red;
            lblModel.Text = "🟢 27B 模型服务 [8080]: " + (modelAlive ? "🟢 在线 (RTX 3060 已挂载)" : "🔴 离线 (显存已释放)");
            lblModel.ForeColor = modelAlive ? Color.Green : Color.Gray;
            lblHosts.Text = "🛡️ Hosts 强拦截: " + (hostsIntercept ? "🟢 已开启 (流量锁至本地)" : "⚪ 未开启 (允许云端)");
            lblHosts.ForeColor = hostsIntercept ? Color.Green : Color.Black;
            string currentBaseUrl = ReadCodexBaseUrl();
            bool localRoute = currentBaseUrl != null && currentBaseUrl.IndexOf("127.0.0.1", StringComparison.OrdinalIgnoreCase) >= 0;
            lblModelInfo.Text = "当前模型：" + (localRoute ? "本地 27B (PTQ1_0)" : "云端 DeepSeek 回退") + "    上下文限制：32,768 Tokens\n路由接口：" + (currentBaseUrl ?? "未读取到 base_url")
                + (String.IsNullOrEmpty(statusNotice) ? "" : "\n" + statusNotice);
        }
        private void SetNotice(string message)
        {
            if (String.IsNullOrEmpty(message)) { statusNotice = ""; return; }
            statusNotice = String.IsNullOrEmpty(statusNotice) ? message : statusNotice + "  " + message;
        }

        private static string ReadCodexBaseUrl()
        {
            try
            {
                if (!File.Exists(CodexConfigPath)) return null;
                foreach (string line in File.ReadAllLines(CodexConfigPath))
                {
                    Match match = Regex.Match(line, @"^\s*(?:base_url|api_base)\s*=\s*[""']([^""']*)[""']");
                    if (match.Success) return match.Groups[1].Value;
                }
            }
            catch { }
            return null;
        }

        // 追加到根级（第一个 [section] 之前），避免 base_url 落进其它 TOML 表而不生效。
        private static string AppendBaseUrlAtRoot(string content, string baseUrl)
        {
            string line = "base_url = \"" + baseUrl + "\"";
            Match section = Regex.Match(content, @"(?m)^[ \t]*\[[^\]]*\][ \t]*$");
            if (!section.Success)
                return content + (content.Length == 0 || content.EndsWith("\n") ? "" : "\n") + line + "\n";
            int lineStart = content.LastIndexOf('\n', section.Index) + 1;
            return content.Substring(0, lineStart) + line + "\n" + content.Substring(lineStart);
        }

        private static bool TrySetCodexBaseUrl(string baseUrl, out string error)
        {
            error = null;
            try
            {
                // 修复①：始终写用户家目录的全局 Codex 配置（目录可能尚未创建）。
                string directory = Path.GetDirectoryName(CodexConfigPath);
                if (!String.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
                string content = File.Exists(CodexConfigPath) ? File.ReadAllText(CodexConfigPath) : "";

                // 修复②：base_url / api_base 双键兼容；用 MatchEvaluator 生成替换串，避免 URL 中的 $ 被当作组引用。
                string updated = Regex.Replace(content, BaseUrlPattern, match => match.Groups[1].Value + "\"" + baseUrl + "\"");
                // 判据是"字段是否存在"，不能比较 updated == content：写入相同值时会被误判为缺失并追加出重复键。
                if (!Regex.IsMatch(content, BaseUrlPattern))
                    updated = AppendBaseUrlAtRoot(content, baseUrl);   // 文件本就没有该字段：自动追加
                File.WriteAllText(CodexConfigPath, updated, new UTF8Encoding(false));
                return true;
            }
            catch (Exception ex)
            {
                error = ex.Message;
                return false;
            }
        }

        // 修复③：确保 VS Code 全局设置里存在 "http.proxySupport": "off"，否则代理会拦截发往本地网关的请求。
        private static bool TryEnsureVsCodeProxyOff(out string error)
        {
            error = null;
            try
            {
                string directory = Path.GetDirectoryName(VsCodeSettingsPath);
                if (!String.IsNullOrEmpty(directory) && !Directory.Exists(directory))
                {
                    // 只在 VS Code 已安装（%APPDATA%\Code 存在）时补建 User 目录，避免凭空造出一份假配置。
                    string parent = Path.GetDirectoryName(directory);
                    if (String.IsNullOrEmpty(parent) || !Directory.Exists(parent))
                    {
                        error = "未检测到 VS Code 全局设置目录 " + directory;
                        return false;
                    }
                    Directory.CreateDirectory(directory);
                }

                string content = File.Exists(VsCodeSettingsPath) ? File.ReadAllText(VsCodeSettingsPath) : "";
                string updated;
                if (Regex.IsMatch(content, "(?i)\"http\\.proxysupport\"\\s*:"))
                {
                    updated = Regex.Replace(content, "(?i)(\"http\\.proxysupport\"\\s*:\\s*)(\"[^\"]*\"|[^,}\\r\\n]*)", "${1}\"off\"");
                }
                else
                {
                    int brace = content.IndexOf('{');
                    if (brace < 0)
                    {
                        updated = "{\n  \"http.proxySupport\": \"off\"\n}\n";
                    }
                    else
                    {
                        int tail = brace + 1;
                        while (tail < content.Length && Char.IsWhiteSpace(content[tail])) tail++;
                        bool emptyObject = tail < content.Length && content[tail] == '}';
                        updated = content.Substring(0, brace + 1) + "\n  \"http.proxySupport\": \"off\""
                            + (emptyObject ? "\n" : ",\n") + content.Substring(brace + 1);
                    }
                }
                if (updated != content) File.WriteAllText(VsCodeSettingsPath, updated, new UTF8Encoding(false));
                return true;
            }
            catch (UnauthorizedAccessException ex) { error = "需要管理员权限或文件被占用：" + ex.Message; return false; }
            catch (Exception ex) { error = ex.Message; return false; }
        }

        private void BtnStartLocal_Click(object sender, EventArgs e)
        {
            SetNotice("");
            if (!IsPortListening(8080))
            {
                if (!File.Exists(ServerPath) || !File.Exists(ModelPath))
                {
                    SetNotice("⚠ 未找到本地模型服务或 GGUF 模型文件，已跳过本地推理启动，仅切换路由到本地网关。");
                }
                else
                {
                    string cachedModelPath = null;
                    try { cachedModelPath = RunCacheAction("Prepare", ModelPath); }
                    catch (Exception ex) { SetNotice("⚠ SSD 模型缓存未就绪，已跳过本地推理启动：" + ex.Message); }

                    if (String.IsNullOrWhiteSpace(cachedModelPath))
                    {
                        if (String.IsNullOrEmpty(statusNotice)) SetNotice("⚠ SSD 缓存未返回有效模型路径，已跳过本地推理启动。");
                    }
                    else
                    {
                        string cmdArgs = "/k \"\"" + ServerPath + "\" -m \"" + cachedModelPath + "\" -ngl 99 --port 8080 -c 32768\"";
                        ProcessStartInfo psi = new ProcessStartInfo("cmd.exe", cmdArgs);
                        psi.UseShellExecute = true;
                        try { Process.Start(psi); }
                        catch (Exception ex)
                        {
                            try { RunCacheAction("Cleanup"); }
                            catch (Exception cleanupEx) { System.Diagnostics.Debug.WriteLine("缓存清理失败：" + cleanupEx); }
                            SetNotice("⚠ 无法启动本地模型服务，已跳过本地推理启动：" + ex.Message);
                        }
                    }
                }
            }

            ClearGatewayPort();
            EnsureGatewayRunning();

            // 面板按钮承诺"锁定本地流量"：这里补齐被遗漏的 Hosts 开启调用（需要管理员权限，失败会弹窗提示）。
            SetHostsState(true, true);

            string configError;
            if (!TrySetCodexBaseUrl(LocalBaseUrl, out configError))
                SetNotice("⚠ 未能写入 config.toml：" + configError);

            string proxyError;
            if (!TryEnsureVsCodeProxyOff(out proxyError))
                SetNotice("⚠ 未能关闭 VS Code 代理干扰：" + proxyError);

            RefreshStatus();
        }

        private string RunCacheAction(string action, string modelPath = null)
        {
            string arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + ModelCacheScript + "\" -Action " + action;
            if (!String.IsNullOrWhiteSpace(modelPath)) arguments += " -ModelPath \"" + modelPath + "\"";
            ProcessStartInfo psi = new ProcessStartInfo("powershell.exe", arguments);
            psi.CreateNoWindow = true;
            psi.UseShellExecute = false;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.StandardOutputEncoding = Encoding.UTF8;
            psi.StandardErrorEncoding = Encoding.UTF8;
            using (Process process = Process.Start(psi))
            {
                string output = process.StandardOutput.ReadToEnd().Trim();
                string error = process.StandardError.ReadToEnd().Trim();
                process.WaitForExit();
                if (process.ExitCode != 0) throw new InvalidOperationException(String.IsNullOrWhiteSpace(error) ? "缓存脚本执行失败。" : error);
                if (action == "Prepare" && (String.IsNullOrWhiteSpace(output) || !File.Exists(output)))
                    throw new InvalidOperationException("缓存脚本未返回有效的 SSD 模型路径。");
                if (!String.IsNullOrWhiteSpace(error)) System.Diagnostics.Debug.WriteLine(error);
                return output;
            }
        }

        private void MainForm_FormClosing(object sender, FormClosingEventArgs e)
        {
            timer.Stop();
            StopLocalMode();
        }

        private void StopLocalMode(bool interactive = false)
        {
            SetHostsState(false, interactive);
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo("taskkill", "/F /IM llama-server.exe");
                psi.CreateNoWindow = true;
                psi.UseShellExecute = false;
                using (Process process = Process.Start(psi)) process.WaitForExit();
            }
            catch (Exception ex) { System.Diagnostics.Debug.WriteLine("停止模型服务失败：" + ex); }
            DateTime deadline = DateTime.UtcNow.AddSeconds(10);
            while (IsPortListening(8080) && DateTime.UtcNow < deadline) System.Threading.Thread.Sleep(250);
            if (IsPortListening(8080))
            {
                SetNotice("⚠ 8080 端口仍有模型服务运行，已保留 SSD 缓存以避免删除正在使用的模型文件。");
                return;
            }
            try { RunCacheAction("Cleanup"); }
            catch (Exception ex) { SetNotice("⚠ 未能确认 C 盘临时缓存已释放：" + ex.Message); }
        }
        private void BtnStopLocal_Click(object sender, EventArgs e)
        {
            SetNotice("");
            StopLocalMode(true);
            string configError;
            if (!TrySetCodexBaseUrl(CloudBaseUrl, out configError))
                SetNotice("⚠ 未能写入 config.toml：" + configError);
            string proxyError;
            if (!TryEnsureVsCodeProxyOff(out proxyError))
                SetNotice("⚠ 未能关闭 VS Code 代理干扰：" + proxyError);
            RefreshStatus();
        }
        private void BtnRestartGateway_Click(object sender, EventArgs e)
        {
            SetNotice("");
            bool cleared = ClearGatewayPort();
            bool started = EnsureGatewayRunning();
            if (started) started = WaitForPort(8000, true, 10);
            if (started) SetNotice(cleared ? "🔄 网关已重新加载。" : "🔄 网关已重新加载（旧进程未完全退出，可能存在端口残留）。");
            else SetNotice("⚠ 网关重启失败，请检查 " + GatewayScript + " 是否存在。");
            RefreshStatus();
            if (started) MessageBox.Show(this, "网关已重新加载", "重启路由网关", MessageBoxButtons.OK, MessageBoxIcon.Information);
            else MessageBox.Show(this, "网关重启失败，请检查 " + GatewayScript + " 是否存在以及 PowerShell 是否可用。", "重启路由网关", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }

        [STAThread]
        static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MainForm());
        }
    }
}


