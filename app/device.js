/* Tizen APIs and the TV-local Samsung app endpoint. No external server or credentials. */
(function () {
  'use strict';
  var IDS = {
    stremio: 'IkWsFHtOY9.Stremio', netflix: 'org.tizen.netflix-app',
    disneyplus: 'MCmYXNxgcu.DisneyPlus', youtube: '9Ur5IzDKqV.TizenYouTube',
    appletv: 'com.samsung.tv.aria-video', primevideo: 'org.tizen.primevideo',
    abciview: 'mWK87Xghap.ABCiview', sbs: 'OyE7OuxlUi.SBSOnDemand',
    applemusic: 'org.tizen.apple.apple-music'
  };
  var STREAMING = ['as6cYRgkPy.Binge', '73iTZRTc34.Stan', '5b8c3eb16b.BeamCTVDev',
    'cj37Ni3qXM.HBONow', 'LBUAQX1exg.Hulu', 'gzcc4LRFBF.Peacock', 'rJyOSqC6Up.CBSAllAccess',
    'Rk72oKFsRS.OtterKidsProd', '70fRFUwYlD.OtterGAProd', 'PvWgqxV3Xa.YouTubeTV',
    'XtU8fQk2gN.ESPN', 'ZmmGjO6VKO.slingtv', 'VtuWAiZdHN.STARZPlay', 'ckfgqqzvt0.dplus',
    'kk8MbItQ0H.VUDU', 'Jz7aUrV2Q4.Twitch', 'OK2Rdkjmsi.IMDbTV', 'Ob3XhAVMu6.amcplus',
    'KaLitts8bq.tenplaySamsungTizen', 'eYuOiOLYQX.KayoSports', 'Ne2ZsPWdKl.9NOW',
    '3KA0pm7a7V.TubiTV', 'rJeHak5zRg.Spotify', 'icp4AvUPiA.7plus'];
  var CONSUMER_SYSTEM = ['org.tizen.browser', 'com.microsoft.copilot'];
  var EXTRA_BRANDS = {'rJeHak5zRg.Spotify': 'spotify', '5b8c3eb16b.BeamCTVDev': 'hbomax', 'cj37Ni3qXM.HBONow': 'hbomax', '3KA0pm7a7V.TubiTV': 'tubi'};
  var INTERNAL = ['adplatform.ADPlayer', 'WykOS4t4F0.cmsWebApp', '25emanual3.emanual',
    'd0m1lV1nt2.emanual', '2022ePop01.SmartTV',
    'ZODRT12q2l.WebAccountExtension', 'ByJlgt0XeD.CastSettingsApp', 'tv6pbVMQFF.PrivacyChoices'];
  var SELF = 'nClrkHome1.FrameHome';
  var BRAND_PACKAGES = {IkWsFHtOY9: 'stremio', DqEoaplKlw: 'bbciplayer', OCaxbgg9v6: 'channel4', OEvCiupaFR: 'itvx', OfLpiC2MZQ: 'stv'};
  function brandForApp(a) {
    var id = a.appId || a.id || '', prefix = id.split('.')[0], brand = BRAND_PACKAGES[prefix];
    if (brand) return brand;
    var keys = Object.keys(IDS), i;
    for (i = 0; i < keys.length; i++) if (IDS[keys[i]] === id) return keys[i];
    return EXTRA_BRANDS[id] || '';
  }
  function api() { return window.tizen && window.tizen.application; }
  function selfId() {
    try { return api().getCurrentApplication().appInfo.id || SELF; }
    catch (err) { return SELF; }
  }
  function unavailable(done) {
    done({ message: 'Open CleanFrame on the TV to use this control.', detail: 'The web preview cannot control the TV.' });
  }
  function failure(err) {
    return { message: 'The TV could not open this screen.', detail: err && (err.message || err.name) || 'Try again, or press the remote’s Home button to return to CleanFrame.' };
  }
  function bounded(done, timeout) {
    var finished = false, timer = setTimeout(function () { finish({ message: 'The TV did not respond. Please try again.' }); }, timeout || 8000);
    function finish(err, value) { if (finished) return; finished = true; clearTimeout(timer); done(err, value); }
    return finish;
  }
  var sourceCancel = null;
  function cancelSource() { if (sourceCancel) sourceCancel(); }
  function sources(done) {
    var sys = window.tizen && window.tizen.systeminfo, tvw = window.tizen && window.tizen.tvwindow;
    if (!sys || typeof sys.getPropertyValue !== 'function' || !tvw || typeof tvw.setSource !== 'function') { unavailable(done); return; }
    var finish = bounded(done);
    try {
      sys.getPropertyValue('VIDEOSOURCE', function (video) {
        var list = [], byPort = {}, active = null;
        try { if (typeof tvw.getSource === 'function') active = tvw.getSource(); } catch (err) { /* Status may be unavailable while discovery still works. */ }
        function record(src, connected) {
          if (!src || src.type !== 'HDMI' || typeof src.number !== 'number' || !isFinite(src.number) || src.number < 0 || Math.floor(src.number) !== src.number) return;
          var key = String(src.number), item = byPort[key];
          if (!item) {
            item = { number: src.number, name: 'HDMI ' + src.number, connected: false, active: !!(active && active.type === 'HDMI' && active.number === src.number), source: src };
            byPort[key] = item; list.push(item);
          }
          if (connected) { item.connected = true; item.source = src; }
        }
        if (video && Array.isArray(video.disconnected)) video.disconnected.forEach(function (src) { record(src, false); });
        if (video && Array.isArray(video.connected)) video.connected.forEach(function (src) { record(src, true); });
        list.sort(function (a, b) { return a.number - b.number; });
        finish(null, list);
      }, function (err) { finish(failure(err)); });
    } catch (err) { finish(failure(err)); }
  }
  function setSource(port, done) {
    cancelSource();
    var tvw = window.tizen && window.tizen.tvwindow, app = api(), finished = false;
    if (typeof port !== 'number' || !isFinite(port) || port < 0 || Math.floor(port) !== port) { done({ message: 'This HDMI input is not available.' }); return; }
    if (!tvw || typeof tvw.setSource !== 'function' || !app || typeof app.launch !== 'function') { unavailable(done); return; }
    var timer = setTimeout(function () { finish({ message: 'The TV did not respond. Please try again.' }); }, 8000);
    function finish(err, value) {
      if (finished) return;
      finished = true; clearTimeout(timer);
      if (sourceCancel === cancel) sourceCancel = null;
      done(err, value);
    }
    function cancel() { finish({ message: 'Input change cancelled.', cancelled: true }); }
    sourceCancel = cancel;
    sources(function (err, list) {
      if (finished) return;
      if (err) { finish(err); return; }
      var input = null;
      list.some(function (item) { if (item.number === port) { input = item; return true; } return false; });
      if (!input) { finish({ message: 'This HDMI input is no longer available.' }); return; }
      try {
        tvw.setSource(input.source, function (selected) {
          if (finished) return;
          if (selected && (selected.type !== 'HDMI' || selected.number !== port)) { finish({ message: 'The TV selected a different input. Please try again.' }); return; }
          try {
            app.launch('org.tizen.tv-viewer', function () { finish(null, input); }, function () {
              finish({ message: 'The input was selected, but the TV viewer could not open.', detail: 'Use the remote’s Source control to view the input.' });
            });
          } catch (error) { finish({ message: 'The input was selected, but the TV viewer could not open.' }); }
        }, function (error) { if (!finished) finish(failure(error)); });
      } catch (error) { finish(failure(error)); }
    });
  }
  function launchApp(id, done) {
    if (id === 'cleanframe.hdmi4' || id === 'cleanframe.hdmi5') { setSource(Number(id.slice(-1)), done); return; }
    if (!api()) { unavailable(done); return; }
    var finish = bounded(done, id === 'DqEoaplKlw.bbchybrid' ? 20000 : 8000);
    if (id === 'DqEoaplKlw.bbchybrid') { launchBBC(finish); return; }
    try { api().launch(id, function () { finish(null); }, function (err) { finish(failure(err)); }); }
    catch (err) { finish(failure(err)); }
  }
  // Packaging can replace this one origin using ignored .local/samsung-api.json.
  var BBC_ORIGIN = 'http://127.0.0.1:8001';
  var BBC_URL = BBC_ORIGIN + '/api/v2/applications/DqEoaplKlw.bbchybrid';
  var lastBBCPolicy = '';
  if (typeof window.addEventListener === 'function') window.addEventListener('securitypolicyviolation', function (event) {
    if (typeof event.blockedURI === 'string' && event.blockedURI.indexOf(BBC_ORIGIN) === 0) {
      lastBBCPolicy = event.effectiveDirective || event.violatedDirective || 'network policy';
    }
  });
  function launchBBC(done) {
    if (!window.XMLHttpRequest) { done({message: 'Samsung TV launch API is unavailable.'}); return; }
    var xhr = new window.XMLHttpRequest(), finished = false;
    lastBBCPolicy = '';
    function detail(note) {
      var location = window.location || {};
      return 'Samsung API: ' + BBC_ORIGIN + '. Origin: ' + (location.origin || 'unknown')
        + '; protocol: ' + (location.protocol || 'unknown') + '. ' + note
        + (lastBBCPolicy ? ' Browser blocked: ' + lastBBCPolicy + '.' : '');
    }
    function finish(error) { if (finished) return; finished = true; done(error); }
    function rejectionDetail() {
      var note = 'HTTP ' + xhr.status + '.', reason = '', challenge = '';
      try {
        var body = JSON.parse(xhr.responseText), error = body && body.error;
        reason = typeof error === 'string' ? error : error && typeof error.message === 'string' ? error.message
          : body && typeof body.message === 'string' ? body.message : '';
      } catch (err) { /* Do not display arbitrary HTML or authentication response fields. */ }
      if (reason) {
        reason = reason.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\b(Bearer|Basic)\s+\S+/gi, '$1 [redacted]')
          .replace(/\b(token|nonce|password|secret)\s*[:=]\s*\S+/gi, '$1=[redacted]');
        note += ' API message: ' + reason.slice(0, 180) + '.';
      } else note += ' No JSON error message exposed.';
      try {
        var header = xhr.getResponseHeader('WWW-Authenticate') || '';
        var scheme = /^[A-Za-z][A-Za-z0-9_-]*/.exec(header);
        if (scheme) challenge = scheme[0];
      } catch (err) { /* Some TV engines do not expose this response header. */ }
      note += ' Auth scheme: ' + (challenge || 'not exposed') + '.';
      return detail(note);
    }
    try {
      xhr.open('POST', BBC_URL, true);
      xhr.timeout = 18000;
      xhr.onload = function () {
        // A 2xx response acknowledges submission, not visible app startup.
        if (xhr.status >= 200 && xhr.status < 300) { finish(null); return; }
        finish({message: 'Samsung TV API rejected the BBC launch.', detail: rejectionDetail()});
      };
      xhr.onerror = function () {
        finish({message: 'BBC launch request failed.', detail: detail('No readable HTTP response (HTTP 0).')});
      };
      xhr.ontimeout = function () {
        finish({message: 'Samsung TV API launch timed out.', detail: detail('Check the TV before retrying.')});
      };
      // Empty POST, no custom headers, credentials, relay or automatic retry.
      xhr.send(null);
    } catch (err) {
      finish({message: 'Samsung TV launch request could not start.', detail: detail(err.name || 'Request exception.')});
    }
  }
  function launch(brand, done) {
    if (!IDS[brand]) { done({message: 'This app has no launch target.'}); return; }
    launchApp(IDS[brand], done);
  }
  function art(done) {
    if (!api()) { unavailable(done); return; }
    var finish = bounded(done);
    try {
      var data = [new tizen.ApplicationControlData('mode', ['fullscreen']), new tizen.ApplicationControlData('requester', ['mobile'])];
      var control = new tizen.ApplicationControl('http://tizen.org/appcontrol/operation/default', null, null, null, data);
      api().launchAppControl(control, 'org.tizen.art-app', function () { finish(null); }, function (err) { finish(failure(err)); });
    } catch (err) { finish(failure(err)); }
  }
  function home(done) { launchApp('com.samsung.tv.csfs', done); }
  function settings(done) { launchApp('com.samsung.tv.coba.setting', done); }
  function apps(done) {
    if (!api()) { unavailable(done); return; }
    // Large installed catalogues can take longer than a launch response.
    var finish = bounded(done, 20000);
    try {
      api().getAppsInfo(function (list) {
        var seen = {}, result = [], self = selfId();
        list.forEach(function (a) {
          var brand = brandForApp(a), primary = !!brand, stream = STREAMING.indexOf(a.id) >= 0;
          var consumer = /^[A-Za-z0-9]{10}\.[A-Za-z0-9_-]+$/.test(a.id) || CONSUMER_SYSTEM.indexOf(a.id) >= 0;
          if (a.id === self || INTERNAL.indexOf(a.id) >= 0 || seen[a.id] || !a.name || (!primary && !stream && (!a.show || !consumer))) return;
          if (!primary && /(?:service|worker|preview|promotion|plugin|launcher|test|sdk|^ep[ -]|factory|daemon)/i.test(a.name + ' ' + a.id)) return;
          if (/-dummy$/.test(a.id) || a.id === 'com.samsung.tv.cobalt-yt') return;
          seen[a.id] = true;
          result.push({ appId: a.id, name: a.name, brand: brand, icon: a.iconPath || '', rank: primary ? Math.max(0, Object.keys(IDS).indexOf(brand)) : (stream ? 20 : 30) });
        });
        result.sort(function (a, b) { return a.rank - b.rank || a.name.toLowerCase().localeCompare(b.name.toLowerCase()); });
        result.push({appId: 'cleanframe.hdmi4', name: 'LIVE TV', brand: 'livetv', icon: '', rank: 40});
        result.push({appId: 'cleanframe.hdmi5', name: 'PS5', brand: 'ps5', icon: '', rank: 41});
        finish(null, result);
      }, function (err) { finish(failure(err)); });
    } catch (err) { finish(failure(err)); }
  }
  window.FrameDevice = { brandForApp: brandForApp, launch: launch, launchApp: launchApp, art: art, home: home, settings: settings, apps: apps, sources: sources, setSource: setSource, cancelSource: cancelSource };
}());
