// Temporary TV-local relay: one fixed app, no shell or arbitrary execution endpoint.
'use strict';
var http = require('http');
var HOST = '127.0.0.1', PORT = 28199;
var APP = 'DqEoaplKlw.bbchybrid', VERSION = 'cleanframe-bbc-v1';
function createBridge(vetroPort) {
  var busy = false;
  return http.createServer(function (req, res) {
    var origin = req.headers.origin;
    if (origin && origin !== 'null') { res.writeHead(403); res.end(); return; }
    if (origin === 'null') { res.setHeader('Access-Control-Allow-Origin', 'null'); res.setHeader('Vary', 'Origin'); }
    function reply(status, data) {
      res.writeHead(status, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'});
      res.end(JSON.stringify(data));
    }
    if (req.url === '/health' && req.method === 'GET') { reply(200, {ok: true, bridge: VERSION}); return; }
    if (req.url !== '/launch/bbciplayer') { reply(404, {error: 'Unknown route'}); return; }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type'});
      res.end(); return;
    }
    if (req.method !== 'POST') { reply(405, {error: 'Use POST'}); return; }
    req.resume();
    if (busy) { reply(409, {error: 'Launch already in progress'}); return; }
    busy = true;
    var body = JSON.stringify({appId: APP}), finished = false;
    function finish(status, data) {
      if (finished) return;
      finished = true; busy = false; reply(status, data);
    }
    var upstream = http.request({hostname: HOST, port: vetroPort || 8099, path: '/apps/launch', method: 'POST',
      headers: {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body)}}, function (response) {
      var data = '';
      response.setEncoding('utf8');
      response.on('data', function (chunk) {
        data += chunk;
        if (data.length > 65536) { finish(502, {error: 'Vetro response too large'}); response.destroy(); }
      });
      response.on('error', function () { finish(502, {error: 'Vetro response interrupted'}); });
      response.on('end', function () {
        if (finished) return;
        try {
          var result = JSON.parse(data);
          if (response.statusCode === 200 && result.ok === true && result.sent === 1) {
            finish(200, {ok: true, appId: APP, transport: 'vetro-native'});
          } else finish(503, {error: result.error || 'Vetro did not confirm the launch'});
        } catch (err) { finish(502, {error: 'Invalid Vetro response'}); }
      });
    });
    upstream.setTimeout(15000, function () { upstream.destroy(new Error('Vetro timeout')); });
    upstream.on('error', function () { finish(503, {error: 'Vetro unavailable; check its root agent'}); });
    upstream.end(body);
  });
}
module.exports = {createBridge: createBridge};
if (require.main === module) {
  if (process.argv[2] === '--check') {
    var attempts = 0;
    function check() {
      var request = http.get({hostname: HOST, port: PORT, path: '/health'}, function (response) {
        var data = '';
        response.on('data', function (chunk) { data += chunk; });
        response.on('end', function () {
          try { var result = JSON.parse(data); if (result.ok && result.bridge === VERSION) { console.log(data); return; } } catch (err) {}
          console.error('Unexpected bridge health response'); process.exitCode = 1;
        });
      });
      request.setTimeout(2000, function () { request.destroy(); });
      request.on('error', function () {
        if (++attempts < 6) setTimeout(check, 500);
        else { console.error('Bridge did not start'); process.exitCode = 1; }
      });
    }
    check();
  } else {
    var server = createBridge(Number(process.argv[2]) || 8099);
    server.on('error', function (err) { console.error(err.message); process.exitCode = 1; });
    server.listen(PORT, HOST);
  }
}
