using System;
using System.Collections.Generic;
using System.IO;

sealed class FakeStartup : IHomePlatform {
    public HomeState State;
    public int Writes;
    public bool SideEffects;
    public bool FailAfterMain;
    public bool IgnoreStartup;
    public bool RefuseRollback;
    public HomeState Read() => State.Copy();
    public void SetMain(string value) {
        Writes++;
        if (RefuseRollback && value == "DclHome001.Home") throw new Exception("rollback refused");
        State.Main = value;
        if (SideEffects) {
            foreach (string key in HomeStartupPolicy.Keys) State.Strings[key] = value;
            State.Autostart = 1;
        }
        if (FailAfterMain) { FailAfterMain = false; throw new Exception("failed after mutation"); }
    }
    public void SetString(string key, string value) {
        Writes++;
        if (!(IgnoreStartup && key == "db/appfw/startup_appid")) State.Strings[key] = value;
    }
    public void SetAutostart(int value) { Writes++; State.Autostart = value; }
}

class PolicyTests {
    const string Target = "abcdefghij.CleanFrame";
    static HomeState Original(int auto = 1) => new HomeState {
        Main = "DclHome001.Home", Autostart = auto,
        Strings = new Dictionary<string,string> {
            [HomeStartupPolicy.HomeKey] = "DclHome001.Home",
            ["db/appfw/startup_appid"] = "DclHome001.Home",
            ["db/appfw/booting_appid_backup"] = "DclHome001.Home",
            ["db/first_screen/type"] = "com.samsung.tv.csfs"
        }
    };
    static void Assert(bool condition, string message) { if (!condition) throw new Exception(message); }
    static void Main() {
        int count = 0;
        Action<string,Action> test = (name, run) => { run(); count++; Console.WriteLine("PASS " + name); };
        test("plan changes no values and describes Home plus startup", () => {
            var fake = new FakeStartup {State = Original()};
            var result = HomeStartupPolicy.Run(fake, Original(), Target, "plan");
            Assert(result.Success && !result.WriteAttempted && fake.Writes == 0, "plan wrote");
            Assert(result.Desired.Main == Target && result.Desired.Strings["db/appfw/startup_appid"] == Target
                && result.Desired.Strings["db/appfw/booting_appid_backup"] == Target, "startup omitted");
            Assert(HomeStartupPolicy.Same(fake.State, Original()), "plan mutated baseline");
        });
        test("apply assigns all four IDs and preserves Samsung first screen", () => {
            var fake = new FakeStartup {State = Original()};
            var result = HomeStartupPolicy.Run(fake, Original(), Target, "apply");
            Assert(result.Success && result.WriteAttempted && fake.Writes == 4, "wrong write count");
            Assert(fake.State.Main == Target && fake.State.Strings[HomeStartupPolicy.HomeKey] == Target
                && fake.State.Strings["db/appfw/startup_appid"] == Target
                && fake.State.Strings["db/appfw/booting_appid_backup"] == Target, "wrong assignment");
            Assert(fake.State.Autostart == 1 && fake.State.Strings["db/first_screen/type"] == "com.samsung.tv.csfs", "unrelated value changed");
        });
        test("startup scope explicitly enables autostart from a disabled baseline", () => {
            var fake = new FakeStartup {State = Original(0)};
            Assert(HomeStartupPolicy.Run(fake, Original(0), Target, "apply").Success && fake.State.Autostart == 1, "autostart omitted");
            Assert(HomeStartupPolicy.Run(fake, Original(0), Target, "restore").Success && HomeStartupPolicy.Same(fake.State, Original(0)), "autostart not restored");
        });
        test("native setter side effects are reconciled to desired first screen", () => {
            var fake = new FakeStartup {State = Original(), SideEffects = true};
            Assert(HomeStartupPolicy.Run(fake, Original(), Target, "apply").Success, "apply failed");
            Assert(fake.State.Strings["db/first_screen/type"] == "com.samsung.tv.csfs", "derived first screen retained");
        });
        test("failure after mutation restores the exact Aero baseline", () => {
            var fake = new FakeStartup {State = Original(), SideEffects = true, FailAfterMain = true};
            var result = HomeStartupPolicy.Run(fake, Original(), Target, "apply");
            Assert(!result.Success && result.RollbackVerified && HomeStartupPolicy.Same(fake.State, Original()), "rollback not exact");
        });
        test("ignored startup setter is a failure with verified rollback", () => {
            var fake = new FakeStartup {State = Original(), IgnoreStartup = true};
            var result = HomeStartupPolicy.Run(fake, Original(), Target, "apply");
            Assert(!result.Success && result.RollbackVerified && HomeStartupPolicy.Same(fake.State, Original()), "silent startup failure");
        });
        test("failed rollback is never reported as success", () => {
            var fake = new FakeStartup {State = Original(), FailAfterMain = true, RefuseRollback = true};
            var result = HomeStartupPolicy.Run(fake, Original(), Target, "apply");
            Assert(!result.Success && !result.RollbackVerified && result.Error.Contains("Rollback failed"), "rollback failure hidden");
        });
        test("restore returns Home and startup to exact Aero values", () => {
            var fake = new FakeStartup {State = Original()};
            Assert(HomeStartupPolicy.Run(fake, Original(), Target, "apply").Success, "apply failed");
            Assert(HomeStartupPolicy.Run(fake, Original(), Target, "restore").Success && HomeStartupPolicy.Same(fake.State, Original()), "restore failed");
        });
        test("changed current state blocks plan and apply with no writes", () => {
            foreach (string action in new[] {"plan", "apply"}) {
                var fake = new FakeStartup {State = Original()};
                fake.State.Strings["db/appfw/startup_appid"] = "third.party";
                Assert(!HomeStartupPolicy.Run(fake, Original(), Target, action).Success && fake.Writes == 0, "drift accepted");
            }
        });
        test("restore refuses an unrelated Home owner", () => {
            var fake = new FakeStartup {State = Original()}; fake.State.Main = "third.party";
            Assert(!HomeStartupPolicy.Run(fake, Original(), Target, "restore").Success && fake.Writes == 0, "foreign owner overwritten");
        });
        test("inspect reports drift without writing or rejecting the diagnosis", () => {
            var fake = new FakeStartup {State = Original()}; fake.State.Main = "third.party";
            var result = HomeStartupPolicy.Run(fake, Original(), Target, "inspect");
            Assert(result.Success && !result.WriteAttempted && fake.Writes == 0 && result.After.Main == "third.party", "inspect changed state");
        });
        test("restore accepts a partially applied transaction and preserves first screen", () => {
            var fake = new FakeStartup {State = Original()};
            fake.State.Main = Target;
            fake.State.Strings[HomeStartupPolicy.HomeKey] = Target;
            fake.State.Strings["db/appfw/booting_appid_backup"] = Target;
            var result = HomeStartupPolicy.Run(fake, Original(), Target, "restore");
            Assert(result.Success && HomeStartupPolicy.Same(fake.State, Original()), "partial restore failed");
        });
        test("explicit protocol three startup request is accepted", () => {
            string file = Path.GetTempFileName();
            File.WriteAllText(file, "{\"schema\":1,\"transport_protocol\":3,\"scope\":\"home-and-startup\",\"action\":\"plan\"}");
            try {
                using var request = RequestFile.Read(new[] {file});
                Assert(request.RootElement.GetProperty("action").GetString() == "plan", "valid request rejected");
            } finally { File.Delete(file); }
        });
        test("protocol 2 or missing startup scope cannot authorize this helper", () => {
            foreach (string request in new[] {
                "{\"schema\":1,\"transport_protocol\":2,\"scope\":\"home-and-startup\",\"action\":\"apply\"}",
                "{\"schema\":1,\"transport_protocol\":3,\"action\":\"apply\"}"
            }) {
                string file = Path.GetTempFileName(); File.WriteAllText(file, request);
                bool refused = false;
                try { using var document = RequestFile.Read(new[] {file}); } catch { refused = true; }
                finally { File.Delete(file); }
                Assert(refused, "old or unscoped request accepted");
            }
        });
        Console.WriteLine(count + " Home-and-startup policy tests passed; no native TV library loaded.");
    }
}
