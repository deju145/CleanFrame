// Home and startup transaction. Derived from the guarded Home-only policy.
// See AeroTizen-LICENSE.txt for the original transaction-design attribution.
using System;
using System.Collections.Generic;
using System.Linq;

// Home and startup transaction logic. Kept separate so failure handling can be tested
// without loading Tizen libraries or executing any native settings calls.
public sealed class HomeState {
    public string Main { get; set; }
    public Dictionary<string,string> Strings { get; set; }
    public int Autostart { get; set; }
    public HomeState Copy() => new HomeState {
        Main = Main, Strings = new Dictionary<string,string>(Strings), Autostart = Autostart
    };
}
public interface IHomePlatform {
    HomeState Read();
    void SetMain(string value);
    void SetString(string key, string value);
    void SetAutostart(int value);
}
public sealed class HomeResult {
    public bool Success { get; set; }
    public bool WriteAttempted { get; set; }
    public bool RollbackVerified { get; set; }
    public string Error { get; set; }
    public HomeState Before { get; set; }
    public HomeState Desired { get; set; }
    public HomeState After { get; set; }
}
public static class HomeStartupPolicy {
    public const string HomeKey = "db/appfw/home_appid";
    public static readonly string[] Keys = {
        HomeKey, "db/appfw/startup_appid", "db/appfw/booting_appid_backup", "db/first_screen/type"
    };
    public static void Validate(HomeState value) {
        if (value == null || string.IsNullOrWhiteSpace(value.Main) || value.Strings == null ||
            value.Strings.Count != Keys.Length || (value.Autostart != 0 && value.Autostart != 1))
            throw new Exception("Incomplete or unsupported Home snapshot.");
        foreach (string key in Keys)
            if (!value.Strings.ContainsKey(key) || string.IsNullOrWhiteSpace(value.Strings[key]))
                throw new Exception("Missing or empty original setting: " + key);
    }
    public static bool Same(HomeState a, HomeState b) =>
        a.Main == b.Main && a.Autostart == b.Autostart && Keys.All(key => a.Strings[key] == b.Strings[key]);

    static void Write(IHomePlatform platform, HomeState desired) {
        if (platform.Read().Main != desired.Main) {
            platform.SetMain(desired.Main);
            if (platform.Read().Main != desired.Main) throw new Exception("Home operation readback failed.");
        }
        // The native operation setter can change derived startup preferences.
        // Reconcile every field to the explicit reviewed desired state.
        foreach (string key in Keys) {
            if (platform.Read().Strings[key] == desired.Strings[key]) continue;
            platform.SetString(key, desired.Strings[key]);
            if (platform.Read().Strings[key] != desired.Strings[key]) throw new Exception("Setting readback failed: " + key);
        }
        if (platform.Read().Autostart != desired.Autostart) {
            platform.SetAutostart(desired.Autostart);
            if (platform.Read().Autostart != desired.Autostart) throw new Exception("Autostart readback failed.");
        }
        if (!Same(platform.Read(), desired)) throw new Exception("Final snapshot differs from the requested state.");
    }
    static void CheckRestore(HomeState current, HomeState original, string target) {
        if (current.Main != original.Main && current.Main != target)
            throw new Exception("Another app owns Home; restore needs review.");
        foreach (string key in Keys)
            if (current.Strings[key] != original.Strings[key] && current.Strings[key] != target)
                throw new Exception("Unrelated setting changed; restore needs review: " + key);
        if (current.Autostart != original.Autostart && current.Autostart != 1)
            throw new Exception("Autostart changed outside this Home/startup experiment; restore needs review.");
    }
    public static HomeResult Run(IHomePlatform platform, HomeState original, string target, string action) {
        var result = new HomeResult();
        try {
            Validate(original);
            if (string.IsNullOrWhiteSpace(target) || original.Main == target || original.Strings.Values.Contains(target) || original.Main != original.Strings[HomeKey])
                throw new Exception("Original state or target is unsuitable for this experiment.");
            if (!new[] {"plan", "inspect", "apply", "restore"}.Contains(action)) throw new Exception("Unknown action.");
            result.Before = platform.Read();
            Validate(result.Before);
            var desired = original.Copy();
            if (action != "restore") {
                desired.Main = target;
                desired.Strings[HomeKey] = target;
                desired.Strings["db/appfw/startup_appid"] = target;
                desired.Strings["db/appfw/booting_appid_backup"] = target;
                desired.Autostart = 1;
            }
            result.Desired = desired;
            if (action == "inspect") { result.After = result.Before; result.Success = true; return result; }
            if (action == "restore") CheckRestore(result.Before, original, target);
            else if (!Same(result.Before, original)) throw new Exception("Settings changed since the baseline; no apply allowed.");
            if (action == "plan") { result.After = result.Before; result.Success = true; return result; }
            if (Same(result.Before, desired)) { result.After = result.Before; result.Success = true; return result; }
            if (!Same(platform.Read(), result.Before)) throw new Exception("Settings changed during preflight; no write attempted.");
            result.WriteAttempted = true;
            try {
                Write(platform, desired);
                result.After = platform.Read();
                result.Success = true;
            } catch (Exception error) {
                result.Error = error.Message;
                // Apply rolls back toward the exact saved originals, including
                // side effects from a setter which mutated state then failed.
                // A failed explicit restore stays a failed restore; never undo it.
                if (action == "apply") {
                    try { Write(platform, original); result.RollbackVerified = Same(platform.Read(), original); }
                    catch (Exception rollback) { result.Error += " Rollback failed: " + rollback.Message; }
                }
                try { result.After = platform.Read(); } catch { }
            }
        } catch (Exception error) { result.Error = error.Message; }
        return result;
    }
}
