"use strict";

// Some Frame Pro sets expose their panel's HDMI socket only through IP Control.
// Keep this separate from TVWindow: a fabricated native source is not accepted.
var https = require("https");
var fs = require("fs");

module.exports = function (tz) {
  var path = null;
  var config = null;
  var busy = false;

  function validate(value) {
    if (
      !value ||
      value.schema !== 1 ||
      typeof value.host !== "string" ||
      !/^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(value.host) ||
      !/^\d{1,3}(\.\d{1,3}){3}$/.test(value.host) ||
      value.host.split(".").some(function (n) {
        return Number(n) > 255;
      }) ||
      typeof value.token !== "string" ||
      !value.token.length ||
      value.token.length > 2048
    ) {
      throw new Error("Invalid HDMI 5 configuration");
    }
    return { schema: 1, host: value.host, token: value.token };
  }

  if (tz && tz.filesystem && tz.filesystem.resolve) {
    tz.filesystem.resolve(
      "wgt-private",
      function (directory) {
        try {
          var uri = directory.toURI();
          if (uri.indexOf("file:///") !== 0) {
            return;
          }
          path = decodeURIComponent(uri.slice(7)).replace(/\/$/, "") + "/cleanframe-hdmi5-v1.json";
          if (fs.existsSync(path) && fs.statSync(path).size <= 4096) {
            config = validate(JSON.parse(fs.readFileSync(path, "utf8")));
          }
        } catch (e) {
          config = null;
        }
      },
      function () {},
      "rw"
    );
  }

  function rpc(method, params, done) {
    if (!config) {
      done("NotConfigured");
      return;
    }
    if (busy) {
      done("Busy");
      return;
    }
    busy = true;
    var finished = false;
    var request;
    var timer;
    function finish(error, value) {
      if (finished) {
        return;
      }
      finished = true;
      busy = false;
      clearTimeout(timer);
      done(error, value);
    }
    var payload = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: method,
      params: Object.assign({ AccessToken: config.token }, params || {}),
    });
    try {
      request = https.request(
        {
          hostname: config.host,
          port: 1516,
          path: "/",
          method: "POST",
          // Samsung's local endpoint uses a self-signed certificate. This exception
          // belongs only to this fixed IP Control request, never global TLS state.
          rejectUnauthorized: false,
          agent: false,
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
          },
        },
        function (response) {
          var body = "";
          response.setEncoding("utf8");
          response.on("data", function (chunk) {
            body += chunk;
            if (body.length > 16384) {
              finish("InvalidResponse");
              request.destroy();
            }
          });
          response.on("error", function () {
            finish("ConnectionFailed");
          });
          response.on("end", function () {
            if (finished) {
              return;
            }
            try {
              var reply = JSON.parse(body);
              if (response.statusCode !== 200 || !reply.result || reply.error || reply.code) {
                finish("CommandRejected");
                return;
              }
              finish(null, reply.result);
            } catch (e) {
              finish("InvalidResponse");
            }
          });
        }
      );
      request.on("error", function () {
        finish("ConnectionFailed");
      });
      timer = setTimeout(function () {
        finish("TimedOut");
        request.destroy();
      }, 8000);
      request.end(payload);
    } catch (e) {
      finish("ConnectionFailed");
    }
  }

  function reply(req, res, code, value) {
    var headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
    var origin = (req.headers || {}).origin;
    if (origin === "null" || origin === "file://") {
      headers["Access-Control-Allow-Origin"] = origin;
      headers.Vary = "Origin";
    }
    res.writeHead(code, headers);
    res.end(JSON.stringify(value));
  }

  function configure(req, res) {
    var headers = req.headers || {};
    if (req.method !== "POST" || headers.origin || headers["x-cleanframe-hdmi5"] !== "1") {
      reply(req, res, 403, { error: "Developer connection required" });
      return;
    }
    if (headers["content-type"] !== "application/json") {
      reply(req, res, 415, { error: "JSON required" });
      return;
    }
    if (!path || busy) {
      reply(req, res, 503, { error: "NotReady" });
      return;
    }
    var body = "";
    var finished = false;
    var timer = setTimeout(function () {
      if (!finished) {
        finished = true;
        reply(req, res, 408, { error: "TimedOut" });
      }
    }, 5000);
    req.setEncoding("utf8");
    req.on("data", function (chunk) {
      body += chunk;
      if (!finished && body.length > 4096) {
        finished = true;
        clearTimeout(timer);
        reply(req, res, 413, { error: "Request too large" });
      }
    });
    req.on("error", function () {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        reply(req, res, 400, { error: "Request failed" });
      }
    });
    req.on("end", function () {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);
      var temporary = path + ".tmp";
      try {
        var parsed = JSON.parse(body);
        if (parsed && parsed.enabled === false) {
          if (fs.existsSync(path)) {
            fs.unlinkSync(path);
          }
          config = null;
          reply(req, res, 200, { configured: false });
          return;
        }
        var value = validate(parsed);
        fs.writeFileSync(temporary, JSON.stringify(value), { mode: 384 });
        fs.chmodSync(temporary, 384);
        fs.renameSync(temporary, path);
        config = value;
        reply(req, res, 200, { configured: true });
      } catch (e) {
        try {
          fs.unlinkSync(temporary);
        } catch (ignored) {}
        reply(req, res, 400, { error: "Configuration failed" });
      }
    });
  }

  return {
    handle: function (req, res, pathname) {
      if (pathname === "/control/hdmi5") {
        configure(req, res);
        return true;
      }
      if (pathname !== "/inputs/hdmi5" && pathname !== "/inputs/hdmi5/select") {
        return false;
      }
      var origin = (req.headers || {}).origin;
      if (origin && origin !== "null" && origin !== "file://") {
        reply(req, res, 403, { error: "Local launcher required" });
        return true;
      }
      var select = pathname === "/inputs/hdmi5/select";
      if (req.method !== (select ? "POST" : "GET")) {
        reply(req, res, 405, { error: "Method not allowed" });
        return true;
      }
      if (!config) {
        reply(req, res, select ? 409 : 200, { configured: false });
        return true;
      }
      rpc(
        select ? "inputSourceControl" : "getTVStates",
        select ? { inputSource: "HDMI5" } : null,
        function (error, value) {
          // Never return tokens, TV response bodies, or configuration details.
          reply(req, res, error ? 502 : 200, {
            configured: true,
            ok: !error,
            error: error || null,
            inputSource: value && typeof value.inputSource === "string" ? value.inputSource : null,
          });
        }
      );
      return true;
    },
  };
};
