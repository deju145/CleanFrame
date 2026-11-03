using System;
using System.IO;
using System.Text.Json;

// No native calls: also exercised by the desktop regression checks.
public static class RequestFile {
    public static JsonDocument Read(string[] args) {
        if (args.Length != 1) throw new Exception("Expected one explicit request file.");
        if (new FileInfo(args[0]).Length > 131072) throw new Exception("Oversized request file.");
        var document = JsonDocument.Parse(File.ReadAllBytes(args[0]));
        try {
            var root = document.RootElement;
            if (root.GetProperty("schema").GetInt32() != 1) throw new Exception("Unknown request schema.");
            if (root.GetProperty("transport_protocol").GetInt32() != 2) throw new Exception("Expected explicit request-file protocol 2.");
            string action = root.GetProperty("action").GetString();
            if (Array.IndexOf(new[] {"plan", "inspect", "apply", "restore"}, action) < 0)
                throw new Exception("Unknown Home action.");
            return document;
        } catch { document.Dispose(); throw; }
    }
}
