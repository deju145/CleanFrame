using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

sealed class NativeHome : IHomePlatform {
    const string Operation = "http://tizen.org/appcontrol/operation/main";
    [DllImport("libc")] internal static extern uint getuid();
    [DllImport("libc")] static extern void free(IntPtr pointer);
    [DllImport("libbundle.so.0")] static extern IntPtr bundle_create();
    [DllImport("libbundle.so.0")] static extern void bundle_free(IntPtr bundle);
    [DllImport("libaul.so.0")] static extern int aul_svc_set_operation(IntPtr bundle, string operation);
    [DllImport("libaul.so.0")] static extern int aul_get_default_app(IntPtr bundle, out IntPtr app);
    [DllImport("libvconf.so.0")] static extern IntPtr vconf_get_str(string key);
    [DllImport("libvconf.so.0")] static extern int vconf_get_int(string key, out int value);
    [DllImport("libvconf.so.0")] static extern int vconf_set_str(string key, string value);
    [DllImport("libvconf.so.0")] static extern int vconf_set_int(string key, int value);
    [DllImport("libcapi-appfw-app-operation-tv.so.0")] static extern int app_operation_get_current_app(string operation, out IntPtr value);
    [DllImport("libcapi-appfw-app-operation-tv.so.0")] static extern int app_operation_set_current_app(string operation, string value);
    static void Check(int code) { if (code != 0) throw new Exception("Native call failed: " + code); }
    static string Take(IntPtr pointer) {
        if (pointer == IntPtr.Zero) throw new Exception("Native getter returned null.");
        try { return Marshal.PtrToStringAnsi(pointer); } finally { free(pointer); }
    }
    public static void CheckExports() {
        foreach (var entry in new Dictionary<string,string[]> {
            ["libbundle.so.0"] = new[] {"bundle_create", "bundle_free"},
            ["libaul.so.0"] = new[] {"aul_svc_set_operation", "aul_get_default_app"},
            ["libvconf.so.0"] = new[] {"vconf_get_str", "vconf_get_int", "vconf_set_str", "vconf_set_int"},
            ["libcapi-appfw-app-operation-tv.so.0"] = new[] {"app_operation_get_current_app", "app_operation_set_current_app"}
        }) {
            IntPtr library = NativeLibrary.Load(entry.Key);
            try {
                foreach (string symbol in entry.Value)
                    if (!NativeLibrary.TryGetExport(library, symbol, out _)) throw new Exception("Missing native export: " + symbol);
            } finally { NativeLibrary.Free(library); }
        }
    }
    public HomeState Read() {
        IntPtr bundle = bundle_create();
        if (bundle == IntPtr.Zero) throw new Exception("No query bundle.");
        string main;
        try {
            Check(aul_svc_set_operation(bundle, Operation));
            IntPtr value; Check(aul_get_default_app(bundle, out value)); main = Take(value);
        } finally { bundle_free(bundle); }
        IntPtr direct; Check(app_operation_get_current_app(Operation, out direct));
        if (Take(direct) != main) throw new Exception("Native Home getters disagree; no write allowed.");
        var strings = new Dictionary<string,string>();
        foreach (string key in HomeOnlyPolicy.Keys) strings[key] = Take(vconf_get_str(key));
        int auto; Check(vconf_get_int("db/menu/smart_hub/ontvsetting/auto_start", out auto));
        return new HomeState {Main = main, Strings = strings, Autostart = auto};
    }
    public void SetMain(string value) { Check(app_operation_set_current_app(Operation, value)); }
    public void SetString(string key, string value) { Check(vconf_set_str(key, value)); }
    public void SetAutostart(int value) { Check(vconf_set_int("db/menu/smart_hub/ontvsetting/auto_start", value)); }
}

class HomeOnly {
    static string Value(JsonElement value) {
        if (value.GetProperty("status").GetString() != "ok") throw new Exception("Original native value unavailable.");
        return value.GetProperty("value").GetString();
    }
    static int Main(string[] args) {
        HomeResult result = null;
        string action = AppContext.GetData("CleanFrame.HomeAction") as string;
        string originalHash = null;
        uint? uid = null;
        try {
            if (args.Length != 0 || IntPtr.Size != 4 || RuntimeInformation.ProcessArchitecture != Architecture.Arm)
                throw new Exception("Expected ARM32 and no command arguments.");
            uid = NativeHome.getuid();
            if (uid != 901) throw new Exception("Expected SDK UID 901; root is refused.");
            string encoded = AppContext.GetData("CleanFrame.HomeRequest") as string;
            if (encoded == null || encoded.Length > 131072) throw new Exception("Missing or oversized request.");
            using var request = JsonDocument.Parse(Convert.FromBase64String(encoded));
            var root = request.RootElement;
            if (root.GetProperty("schema").GetInt32() != 1) throw new Exception("Unknown request schema.");
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
            foreach (string key in HomeOnlyPolicy.Keys) strings[key] = Value(values.GetProperty(key));
            var autostart = values.GetProperty("db/menu/smart_hub/ontvsetting/auto_start");
            if (autostart.GetProperty("status").GetString() != "ok") throw new Exception("Original autostart unavailable.");
            var original = new HomeState { Main = Value(values.GetProperty("main_operation")), Strings = strings, Autostart = autostart.GetProperty("value").GetInt32() };
            NativeHome.CheckExports();
            // Restore remains available after the custom launcher is removed.
            if (action != "restore" && action != "inspect" && !Directory.Exists("/opt/usr/home/owner/apps_rw/" + package) && !Directory.Exists("/opt/usr/apps/" + package))
                throw new Exception("Launcher package is missing.");
            if (action == "apply" || action == "restore") {
                // The shared lock is retained: deleting it could let concurrent
                // callers lock different inodes and perform overlapping writes.
                using var guard = new FileStream("/home/owner/share/tmp/sdk_tools/.cleanframe-home-only.lock", FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
                result = HomeOnlyPolicy.Run(new NativeHome(), original, target, action);
            } else result = HomeOnlyPolicy.Run(new NativeHome(), original, target, action);
        } catch (Exception error) { result = new HomeResult {Error = error.Message}; }
        Console.WriteLine("CLEANFRAME_HOME_QUERY=" + JsonSerializer.Serialize(new {
            schema = 1, uid, architecture = RuntimeInformation.ProcessArchitecture.ToString(), action,
            original_sha256 = originalHash, result
        }));
        return result.Success ? 0 : 1;
    }
}
