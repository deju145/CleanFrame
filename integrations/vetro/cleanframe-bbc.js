// Loaded by Vetro's existing service. No separate process or startup hook.
'use strict';
module.exports = function (options) {
  return function (req, res) {
    if ((req.url || '').split('?')[0] !== '/cleanframe/bbciplayer') return false;
    var address = (req.socket || req.connection || {}).remoteAddress;
    var local = address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
    var origin = (req.headers || {}).origin;
    function reply(code, value) {
      res.writeHead(code, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'});
      res.end(JSON.stringify(value));
    }
    if (!local || (origin && origin !== 'null')) { reply(403, {error: 'TV-local requests only'}); return true; }
    if (origin === 'null') { res.setHeader('Access-Control-Allow-Origin', 'null'); res.setHeader('Vary', 'Origin'); }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type'});
      res.end(); return true;
    }
    if (req.method !== 'POST') { reply(405, {error: 'Use POST'}); return true; }
    req.resume();
    Promise.resolve().then(function () { return options.launch(); }).then(function (result) {
      if (!result || result.ok !== true || result.sent !== 1) throw new Error('Native launch was not confirmed');
      reply(200, {ok: true, appId: 'DqEoaplKlw.bbchybrid', transport: 'vetro-native'});
    }).catch(function (err) { reply(503, {error: err.message || 'BBC launch unavailable'}); });
    return true;
  };
};
