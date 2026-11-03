using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;

// Read-only diagnostic: deliberately contains no settings setter imports.
class Query {
    const string Operation = "http://tizen.org/appcontrol/operation/main";
    [DllImport("libc")] static extern uint getuid();
    [DllImport("libc")] static extern void free(IntPtr pointer);
    [DllImport("libbundle.so.0")] static extern IntPtr bundle_create();
    [DllImport("libbundle.so.0")] static extern void bundle_free(IntPtr bundle);
    [DllImport("libaul.so.0")] static extern int aul_svc_set_operation(IntPtr bundle, string operation);
    [DllImport("libaul.so.0")] static extern int aul_get_default_app(IntPtr bundle, out IntPtr app);
    [DllImport("libvconf.so.0")] static extern IntPtr vconf_get_str(string key);
    [DllImport("libvconf.so.0")] static extern int vconf_get_int(string key, out int value);

    static object Read(Func<object> getter) {
        try { return new { status = "ok", value = getter() }; }
        catch (Exception error) { return new { status = "unavailable", error = error.Message }; }
    }
    static string TakeString(IntPtr pointer) {
        if (pointer == IntPtr.Zero) throw new Exception("Getter returned null; no default assumed.");
        try { return Marshal.PtrToStringAnsi(pointer); }
        finally { free(pointer); }
    }
    static string Home() {
        IntPtr bundle = bundle_create();
        if (bundle == IntPtr.Zero) throw new Exception("Could not create query bundle.");
        try {
            // Sets a field in this temporary bundle, not the native Home assignment.
            if (aul_svc_set_operation(bundle, Operation) != 0) throw new Exception("Query operation unavailable.");
            IntPtr app;
            if (aul_get_default_app(bundle, out app) != 0) throw new Exception("Default Home query failed.");
            return TakeString(app);
        } finally { bundle_free(bundle); }
    }
    static int Main(string[] args) {
        try {
            if (args.Length != 0 || IntPtr.Size != 4 || RuntimeInformation.ProcessArchitecture != Architecture.Arm)
                throw new Exception("Expected ARM32 with no command arguments.");
            if (getuid() != 901) throw new Exception("Expected SDK UID 901; root is not accepted.");
            var values = new Dictionary<string, object>();
            values["main_operation"] = Read(() => Home());
            foreach (string key in new[] { "db/appfw/home_appid", "db/appfw/startup_appid", "db/appfw/booting_appid_backup", "db/first_screen/type" })
                values[key] = Read(() => TakeString(vconf_get_str(key)));
            values["db/menu/smart_hub/ontvsetting/auto_start"] = Read(() => {
                int value;
                if (vconf_get_int("db/menu/smart_hub/ontvsetting/auto_start", out value) != 0)
                    throw new Exception("Integer getter failed; no default assumed.");
                return value;
            });
            Console.WriteLine("CLEANFRAME_HOME_QUERY=" + JsonSerializer.Serialize(new {
                schema = 1, uid = getuid(), architecture = RuntimeInformation.ProcessArchitecture.ToString(),
                firmware = Read(() => File.ReadAllText("/etc/prd_info.ini")),
                os = Read(() => File.ReadAllText("/etc/os-release")),
                boot_id = Read(() => File.ReadAllText("/proc/sys/kernel/random/boot_id").Trim()),
                values
            }));
            return 0;
        } catch (Exception error) { Console.Error.WriteLine(error.Message); return 1; }
    }
}
