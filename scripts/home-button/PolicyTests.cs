using System;
using System.Collections.Generic;
using System.IO;

sealed class FakeHome : IHomePlatform {
    public HomeState State;
    public int Writes;
    public bool SideEffects;
    public bool ThrowAfterMain;
    public bool IgnoreHomeKey;
    public bool RefuseRestore;
    public HomeState Read() => State.Copy();
    public void SetMain(string value) {
        Writes++;
        if (RefuseRestore && value == "samsung.home") throw new Exception("restore deliberately unavailable");
        State.Main = value;
        if (SideEffects) {
            State.Strings["db/appfw/startup_appid"] = value;
            State.Strings["db/appfw/booting_appid_backup"] = value;
            State.Strings["db/first_screen/type"] = value;
            State.Autostart = 1;
        }
        if (ThrowAfterMain) { ThrowAfterMain = false; throw new Exception("setter failed after mutation"); }
    }
    public void SetString(string key, string value) {
        Writes++;
        if (!(IgnoreHomeKey && key == HomeOnlyPolicy.HomeKey)) State.Strings[key] = value;
    }
    public void SetAutostart(int value) { Writes++; State.Autostart = value; }
}
class PolicyTests {
    const string Target = "abcdefghij.CleanFrame";
    static HomeState Original() => new HomeState {
        Main = "samsung.home", Autostart = 0,
        Strings = new Dictionary<string,string> {
            [HomeOnlyPolicy.HomeKey] = "samsung.home",
            ["db/appfw/startup_appid"] = "tv.viewer",
            ["db/appfw/booting_appid_backup"] = "tv.viewer",
            ["db/first_screen/type"] = "samsung.home"
        }
    };
    static void Assert(bool condition, string description) { if (!condition) throw new Exception(description); }
    static void Main() {
        int passed = 0;
        Action<string,Action> test = (name, body) => { body(); passed++; Console.WriteLine("PASS " + name); };
        test("plan has zero writes", () => {
            var fake = new FakeHome { State = Original() };
            var result = HomeOnlyPolicy.Run(fake, Original(), Target, "plan");
            Assert(result.Success && !result.WriteAttempted && fake.Writes == 0 && HomeOnlyPolicy.Same(fake.State, Original()), "Plan changed state.");
        });
        test("normal apply changes only the two Home fields", () => {
            var fake = new FakeHome { State = Original() };
            var result = HomeOnlyPolicy.Run(fake, Original(), Target, "apply");
            Assert(result.Success && fake.Writes == 2 && fake.State.Main == Target && fake.State.Strings[HomeOnlyPolicy.HomeKey] == Target, "Apply failed.");
            Assert(fake.State.Autostart == 0 && fake.State.Strings["db/appfw/startup_appid"] == "tv.viewer", "Startup changed.");
        });
        test("derived startup and first-screen side effects repaired", () => {
            var fake = new FakeHome { State = Original(), SideEffects = true };
            var result = HomeOnlyPolicy.Run(fake, Original(), Target, "apply");
            var desired = Original(); desired.Main = Target; desired.Strings[HomeOnlyPolicy.HomeKey] = Target;
            Assert(result.Success && HomeOnlyPolicy.Same(fake.State, desired), "Side effects remained.");
        });
        test("stale baseline refuses before writing", () => {
            var fake = new FakeHome { State = Original() }; fake.State.Strings["db/appfw/startup_appid"] = "other.app";
            var result = HomeOnlyPolicy.Run(fake, Original(), Target, "apply");
            Assert(!result.Success && !result.WriteAttempted && fake.Writes == 0, "Stale apply proceeded.");
        });
        test("setter mutation before error rolls back exactly", () => {
            var fake = new FakeHome { State = Original(), SideEffects = true, ThrowAfterMain = true };
            var result = HomeOnlyPolicy.Run(fake, Original(), Target, "apply");
            Assert(!result.Success && result.WriteAttempted && result.RollbackVerified && HomeOnlyPolicy.Same(fake.State, Original()), "Partial mutation not restored.");
        });
        test("readback failure is not success", () => {
            var fake = new FakeHome { State = Original(), IgnoreHomeKey = true };
            var result = HomeOnlyPolicy.Run(fake, Original(), Target, "apply");
            Assert(!result.Success && result.RollbackVerified && HomeOnlyPolicy.Same(fake.State, Original()), "Readback failure hidden.");
        });
        test("rollback failure reported without claiming restoration", () => {
            var fake = new FakeHome { State = Original(), ThrowAfterMain = true, RefuseRestore = true };
            var result = HomeOnlyPolicy.Run(fake, Original(), Target, "apply");
            Assert(!result.Success && !result.RollbackVerified && result.Error.Contains("Rollback failed") && fake.State.Main == Target, "Rollback failure hidden.");
        });
        test("restore handles partial Home assignment", () => {
            var fake = new FakeHome { State = Original() }; fake.State.Main = Target;
            var result = HomeOnlyPolicy.Run(fake, Original(), Target, "restore");
            Assert(result.Success && HomeOnlyPolicy.Same(fake.State, Original()), "Partial state restore failed.");
        });
        test("restore does not overwrite unrelated owner", () => {
            var fake = new FakeHome { State = Original() }; fake.State.Main = "third.party";
            var result = HomeOnlyPolicy.Run(fake, Original(), Target, "restore");
            Assert(!result.Success && fake.Writes == 0, "Unrelated owner overwritten.");
        });
        test("repeat restore is a zero-write no-op", () => {
            var fake = new FakeHome { State = Original() };
            var result = HomeOnlyPolicy.Run(fake, Original(), Target, "restore");
            Assert(result.Success && fake.Writes == 0, "Repeat restore wrote state.");
        });
        test("inspect works with legitimate drift and writes nothing", () => {
            var fake = new FakeHome { State = Original() }; fake.State.Autostart = 1;
            var result = HomeOnlyPolicy.Run(fake, Original(), Target, "inspect");
            Assert(result.Success && fake.Writes == 0 && result.After.Autostart == 1, "Inspection failed.");
        });
        test("failed restore does not reapply", () => {
            var fake = new FakeHome { State = Original(), RefuseRestore = true }; fake.State.Main = Target;
            var result = HomeOnlyPolicy.Run(fake, Original(), Target, "restore");
            Assert(!result.Success && !result.RollbackVerified && fake.Writes == 1, "Failed restore reapplied.");
        });
        test("explicit request supplies action without runtime properties", () => {
            string path = Path.GetTempFileName();
            try {
                File.WriteAllText(path, "{\"schema\":1,\"transport_protocol\":2,\"action\":\"plan\"}");
                using var request = RequestFile.Read(new[] {path});
                Assert(request.RootElement.GetProperty("action").GetString() == "plan", "Explicit action was lost.");
            } finally { File.Delete(path); }
        });
        test("missing command-line request refused", () => {
            bool refused = false;
            try { using var request = RequestFile.Read(new string[0]); }
            catch (Exception) { refused = true; }
            Assert(refused, "Missing request accepted.");
        });
        test("obsolete protocol and unknown action refused", () => {
            string path = Path.GetTempFileName();
            try {
                foreach (string json in new[] {
                    "{\"schema\":1,\"transport_protocol\":1,\"action\":\"plan\"}",
                    "{\"schema\":1,\"transport_protocol\":2,\"action\":\"unknown\"}"
                }) {
                    File.WriteAllText(path, json); bool refused = false;
                    try { using var request = RequestFile.Read(new[] {path}); }
                    catch (Exception) { refused = true; }
                    Assert(refused, "Invalid request accepted.");
                }
            } finally { File.Delete(path); }
        });
        Console.WriteLine(passed + " policy checks passed.");
    }
}
