'use strict';

// On-demand IP Control bridge only. No Home watcher, root, boot tasks or polling.
var http = require('http');
var server = null;
module.exports.onStart = function () {
  if (server) return;
  var hdmi5 = require('./hdmi5')(typeof tizen !== 'undefined' ? tizen : null);
  server = http.createServer(function (req, res) {
    var pathname = require('url').parse(req.url).pathname;
    if (hdmi5.handle(req, res, pathname)) return;
    res.writeHead(404, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'});
    res.end('{"error":"Not found"}');
  });
  server.listen(47791, '127.0.0.1');
};
module.exports.onRequest = function () {};
module.exports.onExit = function () {
  if (server) { server.close(); server = null; }
};
