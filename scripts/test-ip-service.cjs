const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

function fixture(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "cleanframe-hdmi5-"));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const requests = [];
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync("app/service/hdmi5.js", "utf8"), {
    module,
    Buffer,
    setTimeout,
    clearTimeout,
    require(name) {
      if (name === "fs") return fs;
      assert.equal(name, "https");
      return {
        request(options, callback) {
          const request = new EventEmitter();
          request.destroy = () => {};
          request.end = (data) =>
            requests.push({
              options,
              data: JSON.parse(data),
              respond(value, statusCode = 200) {
                const response = new EventEmitter();
                response.statusCode = statusCode;
                response.setEncoding = () => {};
                callback(response);
                response.emit("data", JSON.stringify(value));
                response.emit("end");
              },
              fail: () => request.emit("error", new Error("sensitive TV response")),
            });
          return request;
        },
      };
    },
  });
  function create() {
    return module.exports({
      filesystem: {
        resolve(name, done) {
          assert.equal(name, "wgt-private");
          done({ toURI: () => "file://" + folder });
        },
      },
    });
  }
  return { create, folder, requests };
}

function call(service, pathname, method = "GET", body, headers = {}) {
  let status;
  let response;
  const req = new EventEmitter();
  req.method = method;
  req.headers = headers;
  req.setEncoding = () => {};
  const handled = service.handle(
    req,
    {
      writeHead(code) {
        status = code;
      },
      end(value) {
        response = JSON.parse(value);
      },
    },
    pathname,
  );
  if (body !== undefined) req.emit("data", JSON.stringify(body));
  req.emit("end");
  return {
    handled,
    get status() {
      return status;
    },
    get response() {
      return response;
    },
  };
}

function configure(service) {
  return call(
    service,
    "/control/hdmi5",
    "POST",
    {
      schema: 1,
      host: "192.168.1.50",
      token: "private-test-token",
    },
    { "x-cleanframe-hdmi5": "1", "content-type": "application/json" },
  );
}

test("configuration requires a developer header, persists privately, and never returns its token", (t) => {
  const f = fixture(t);
  const service = f.create();
  assert.equal(call(service, "/control/hdmi5", "POST", {}).status, 403);
  assert.equal(
    call(
      service,
      "/control/hdmi5",
      "POST",
      {},
      {
        origin: "null",
        "x-cleanframe-hdmi5": "1",
      },
    ).status,
    403,
  );
  const result = configure(service);
  assert.equal(result.status, 200);
  assert.equal(JSON.stringify(result.response), '{"configured":true}');
  const file = path.join(f.folder, "cleanframe-hdmi5-v1.json");
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const restarted = f.create();
  const read = call(restarted, "/inputs/hdmi5");
  assert.equal(f.requests.length, 1);
  f.requests[0].respond({ result: { inputSource: "HDMI5", AccessToken: "must-not-leak" } });
  assert.equal(read.response.inputSource, "HDMI5");
  assert.equal(JSON.stringify(read.response).includes("must-not-leak"), false);
});

test("HDMI 5 selection uses only its fixed method, excludes foreign origins, and never retries", (t) => {
  const f = fixture(t);
  const service = f.create();
  configure(service);
  assert.equal(call(service, "/inputs/hdmi5/select", "GET").status, 405);
  assert.equal(call(service, "/inputs/hdmi5/select", "POST", null, { origin: "https://example.com" }).status, 403);
  const result = call(service, "/inputs/hdmi5/select", "POST");
  assert.deepEqual(f.requests[0].data.params, { AccessToken: "private-test-token", inputSource: "HDMI5" });
  assert.equal(f.requests[0].data.method, "inputSourceControl");
  assert.equal(f.requests[0].options.port, 1516);
  assert.equal(call(service, "/inputs/hdmi5").response.error, "Busy");
  f.requests[0].fail();
  assert.equal(result.response.ok, false);
  assert.equal(JSON.stringify(result.response).includes("sensitive"), false);
  assert.equal(f.requests.length, 1);
  const retryByUser = call(service, "/inputs/hdmi5/select", "POST");
  f.requests[1].respond({ error: { code: -32601, message: "Method not found" } });
  assert.equal(retryByUser.response.error, "CommandRejected");
});

test("disabling removes only HDMI 5 storage and unconfigured selection cannot send a command", (t) => {
  const f = fixture(t);
  const service = f.create();
  assert.equal(call(service, "/inputs/hdmi5/select", "POST").status, 409);
  configure(service);
  const result = call(
    service,
    "/control/hdmi5",
    "POST",
    { enabled: false },
    {
      "x-cleanframe-hdmi5": "1",
      "content-type": "application/json",
    },
  );
  assert.equal(result.response.configured, false);
  assert.equal(fs.existsSync(path.join(f.folder, "cleanframe-hdmi5-v1.json")), false);
  assert.equal(call(service, "/inputs/hdmi5").response.configured, false);
  assert.equal(f.requests.length, 0);
});
