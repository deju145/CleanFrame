using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

class HomeStartup {
    static void CheckAeroWatcher() {
        using var client = new HttpClient(new HttpClientHandler {UseProxy = false});
        client.Timeout = TimeSpan.FromSeconds(3);
        client.MaxResponseContentBufferSize = 65536;
        using var reply = JsonDocument.Parse(client.GetStringAsync("http://127.0.0.1:47790/").GetAwaiter().GetResult());
        var control = reply.RootElement.GetProperty("homeControl");
        if (control.GetProperty("mode").GetString() != "native" || !control.GetProperty("persistent").GetBoolean())
            throw new Exception("AeroTizen watcher must remain persistently disabled in native mode.");
    }
    static string Value(JsonElement value) {
        if (value.GetProperty("status").GetString() != "ok") throw new Exception("Original native value unavailable.");
        return value.GetProperty("value").GetString();
    }
    static int Main(string[] args) {
        HomeResult result = null;
        string action = null;
        string originalHash = null;
        uint? uid = null;
        try {
            if (args.Length != 1 || IntPtr.Size != 4 || RuntimeInformation.ProcessArchitecture != Architecture.Arm)
                throw new Exception("Expected ARM32 and one explicit request file.");
            uid = NativeHome.getuid();
            if (uid != 901) throw new Exception("Expected SDK UID 901; root is refused.");
            using var request = RequestFile.Read(args);
            var root = request.RootElement;
            action = root.GetProperty("action").GetString();
            string target = root.GetProperty("target").GetString();
            string package = root.GetProperty("package").GetString();
            if (!Regex.IsMatch(package ?? "", "^[A-Za-z0-9]{10}$") || !Regex.IsMatch(target ?? "", "^" + Regex.Escape(package) + "\\.[A-Za-z0-9_-]{1,52}$"))
                throw new Exception("Invalid launcher identity.");
            originalHash = root.GetProperty("original_sha256").GetString();
            byte[] originalBytes = Convert.FromBase64String(root.GetProperty("original_base64").GetString());
            string hash = Convert.ToHexString(SHA256.HashData(originalBytes)).ToLowerInvariant();
            if (hash != originalHash) throw new Exception("Original snapshot checksum mismatch.");
            using var originalDoc = JsonDocument.Parse(originalBytes);
            var query = originalDoc.RootElement.GetProperty("query");
            if (query.GetProperty("schema").GetInt32() != 1 || query.GetProperty("uid").GetInt32() != 901 || query.GetProperty("architecture").GetString() != "Arm")
                throw new Exception("Invalid original query identity.");
            string firmware = Value(query.GetProperty("firmware"));
            if (File.ReadAllText("/etc/prd_info.ini") != firmware) throw new Exception("Firmware differs from original snapshot.");
            if (File.ReadAllText("/etc/os-release") != Value(query.GetProperty("os"))) throw new Exception("OS differs from original snapshot.");
            var values = query.GetProperty("values");
            var strings = new Dictionary<string,string>();
            foreach (string key in HomeStartupPolicy.Keys) strings[key] = Value(values.GetProperty(key));
            var autostart = values.GetProperty("db/menu/smart_hub/ontvsetting/auto_start");
            if (autostart.GetProperty("status").GetString() != "ok") throw new Exception("Original autostart unavailable.");
            var original = new HomeState { Main = Value(values.GetProperty("main_operation")), Strings = strings, Autostart = autostart.GetProperty("value").GetInt32() };
            NativeHome.CheckExports();
            // Restore remains available after the custom launcher is removed.
            if (action != "restore" && action != "inspect" && !Directory.Exists("/opt/usr/home/owner/apps_rw/" + package) && !Directory.Exists("/opt/usr/apps/" + package))
                throw new Exception("Launcher package is missing.");
            if (action == "plan" || action == "apply") NativeHome.CheckStartupEligible(target);
            if (action == "apply" || action == "restore") {
                // The shared lock is retained: deleting it could let concurrent
                // callers lock different inodes and perform overlapping writes.
                using var guard = new FileStream("/home/owner/share/tmp/sdk_tools/.cleanframe-home-only.lock", FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
                if (action == "apply" && original.Main == "DclHome001.Home") CheckAeroWatcher();
                result = HomeStartupPolicy.Run(new NativeHome(), original, target, action);
            } else {
                if (action == "plan" && original.Main == "DclHome001.Home") CheckAeroWatcher();
                result = HomeStartupPolicy.Run(new NativeHome(), original, target, action);
            }
        } catch (Exception error) { result = new HomeResult {Error = error.Message}; }
        Console.WriteLine("CLEANFRAME_HOME_QUERY=" + JsonSerializer.Serialize(new {
            schema = 1, transport_protocol = 3, scope = "home-and-startup", uid, architecture = RuntimeInformation.ProcessArchitecture.ToString(), action,
            original_sha256 = originalHash, result
        }));
        return result.Success ? 0 : 1;
    }
}
