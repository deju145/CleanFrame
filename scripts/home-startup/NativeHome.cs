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
    [DllImport("libapp-context-manager-common.so")] static extern byte util_is_appbooting_supported_webapp_byappid(string app);
    public static void CheckStartupEligible(string app) {
        if (util_is_appbooting_supported_webapp_byappid(app) == 0)
            throw new Exception("The installed CleanFrame app is not eligible for native startup.");
    }
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
        foreach (string key in HomeStartupPolicy.Keys) strings[key] = Take(vconf_get_str(key));
        int auto; Check(vconf_get_int("db/menu/smart_hub/ontvsetting/auto_start", out auto));
        return new HomeState {Main = main, Strings = strings, Autostart = auto};
    }
    public void SetMain(string value) { Check(app_operation_set_current_app(Operation, value)); }
    public void SetString(string key, string value) { Check(vconf_set_str(key, value)); }
    public void SetAutostart(int value) { Check(vconf_set_int("db/menu/smart_hub/ontvsetting/auto_start", value)); }
}

