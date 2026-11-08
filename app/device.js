/* Tizen controls plus an optional loopback HDMI 5 bridge. No browser credentials. */
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
  var ipConfigured = false;
  var ipStarting = null;
  function ipService(done) {
    if (ipStarting) { ipStarting.push(done); return; }
    var app = api(), tz = window.tizen;
    if (!app || typeof app.launchAppControl !== 'function' || !tz || typeof tz.ApplicationControl !== 'function') { done(false); return; }
    ipStarting = [done];
    var finish = bounded(function (err) {
      var waiting = ipStarting || [];
      ipStarting = null;
      waiting.forEach(function (callback) { callback(!err); });
    }, 2000);
    try {
      app.launchAppControl(new tz.ApplicationControl('http://tizen.org/appcontrol/operation/service'),
        selfId().split('.')[0] + '.IpControl', function () { finish(null); }, function () { finish(true); });
    } catch (err) { finish(true); }
  }
  function ipRequest(path, method, done, timeout) {
    var request = null;
    var finish = bounded(function (err, value) {
      if (request) { request.onload = request.onerror = request.ontimeout = null; }
      done(err, value);
    }, timeout || 1500);
    try {
      request = new window.XMLHttpRequest();
      request.open(method, 'http://127.0.0.1:47791' + path, true);
      request.timeout = timeout || 1500;
      request.onerror = request.ontimeout = function () { finish(true); };
      request.onload = function () {
        try {
          var value = JSON.parse(request.responseText);
          if (value && typeof value.configured === 'boolean') { ipConfigured = value.configured; finish(null, value); }
          else finish(true);
        } catch (err) { finish(true); }
      };
      request.send();
    } catch (err) { finish(true); }
    return function () { finish(true); if (request && typeof request.abort === 'function') request.abort(); };
  }
  function ipStatus(done) {
    ipService(function (ready) {
      if (!ready) { done(null); return; }
      ipRequest('/inputs/hdmi5', 'GET', function (err, status) {
        if (!err) { done(status); return; }
        // One read-only startup grace, never a retry of a selection command.
        setTimeout(function () { ipRequest('/inputs/hdmi5', 'GET', function (error, value) { done(error ? null : value); }); }, 200);
      });
    });
  }
  var sourceCancel = null;
  // Native source objects are opaque: retain the original reference, never a
  // plain object or JSON copy. This cache lasts only for this running app.
  var knownHdmi5 = null;
  function cancelSource() { if (sourceCancel) sourceCancel(); }
  function sources(done) {
    var sys = window.tizen && window.tizen.systeminfo, tvw = window.tizen && window.tizen.tvwindow;
    if (!sys || (typeof sys.getPropertyValue !== 'function' && typeof sys.getPropertyValueArray !== 'function') || !tvw || typeof tvw.setSource !== 'function') { unavailable(done); return; }
    var finish = bounded(done);
    var nativeList = null, ipState = null, ipDone = false;
    function complete() {
      if (!nativeList || !ipDone) return;
      if (ipState && ipState.configured) {
        nativeList.forEach(function (item) {
          if (typeof ipState.inputSource === 'string') item.active = ipState.inputSource === 'HDMI' + item.number;
          if (item.number === 5) {
            item.ipControl = true; item.manual = false; item.source = null; item.name = 'HDMI 5';
            item.detail = 'Local IP Control'; item.connected = ipState.inputSource === 'HDMI5';
          }
        });
      }
      finish(null, nativeList);
    }
    ipStatus(function (status) { ipState = status; ipDone = true; complete(); });
    function receive(videos) {
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
          if (src.number === 5) knownHdmi5 = item.source;
        }
        videos.forEach(function (video) {
          if (video && Array.isArray(video.disconnected)) video.disconnected.forEach(function (src) { record(src, false); });
          if (video && Array.isArray(video.connected)) video.connected.forEach(function (src) { record(src, true); });
        });
        // getSource() can supply a genuine source omitted by enumeration.
        record(active, false);
        if (!byPort['5'] && knownHdmi5) {
          record(knownHdmi5, false);
          byPort['5'].remembered = true;
        }
        // Keep the requested row reachable, but never pass a fabricated record
        // to setSource: this TV requires SystemInfoVideoSourceInfo branding.
        if (!byPort['5']) {
          var numbers = list.map(function (item) { return item.number; }).sort(function (a, b) { return a - b; });
          var current = active && typeof active.type === 'string' ? active.type + ' ' + active.number : 'unavailable';
          list.push({ number: 5, name: 'HDMI 5', connected: false, active: false, manual: true, source: null,
            detail: 'Reported HDMI inputs: ' + (numbers.join(', ') || 'none') + '. Current source: ' + current + '. Source providers: ' + videos.length + '.' });
        }
        list.sort(function (a, b) { return a.number - b.number; });
        nativeList = list;
        complete();
    }
    function readOne() {
      if (typeof sys.getPropertyValue !== 'function') { finish({ message: 'The TV could not list its inputs.' }); return; }
      try { sys.getPropertyValue('VIDEOSOURCE', function (video) { receive([video]); }, function (err) { finish(failure(err)); }); }
      catch (err) { finish(failure(err)); }
    }
    // Query every property provider while preserving every native record.
    // Older firmware can reject the array API; retain its single-value route.
    if (typeof sys.getPropertyValueArray === 'function') {
      var settled = false, arrayTimer = null;
      var fallback = function () { if (!settled) { settled = true; clearTimeout(arrayTimer); readOne(); } };
      arrayTimer = setTimeout(fallback, 2000);
      try {
        sys.getPropertyValueArray('VIDEOSOURCE', function (videos) {
          if (settled) return;
          if (!Array.isArray(videos) || !videos.length) { fallback(); return; }
          settled = true; clearTimeout(arrayTimer); receive(videos);
        }, fallback);
      } catch (err) { fallback(); }
    } else readOne();
  }
  function setSource(port, done) {
    cancelSource();
    var tvw = window.tizen && window.tizen.tvwindow, app = api(), finished = false;
    if (typeof port !== 'number' || !isFinite(port) || port < 0 || Math.floor(port) !== port) { done({ message: 'This HDMI input is not available.' }); return; }
    if (!tvw || typeof tvw.setSource !== 'function' || !app || typeof app.launch !== 'function') { unavailable(done); return; }
    var abortIp = null;
    var timer = setTimeout(function () { finish({ message: 'The TV did not respond. Please try again.' }); }, 8000);
    function finish(err, value) {
      if (finished) return;
      finished = true; clearTimeout(timer);
      if (sourceCancel === cancel) sourceCancel = null;
      done(err, value);
    }
    function cancel() { finish({ message: 'Input change cancelled.', cancelled: true }); if (abortIp) abortIp(); }
    sourceCancel = cancel;
    function selectIp() {
      clearTimeout(timer);
      timer = setTimeout(function () { finish({ message: 'The TV did not respond. Please try again.' }); }, 12000);
      abortIp = ipRequest('/inputs/hdmi5/select', 'POST', function (err, result) {
        if (finished) return;
        if (err || !result || !result.ok) {
          finish({ message: 'The TV could not switch to HDMI 5.', detail: 'Check IP Control setup. The command was not retried.' }); return;
        }
        openViewer({number: 5, name: 'HDMI 5', ipControl: true});
      }, 10000);
    }
    function openViewer(input) {
      try {
        app.launch('org.tizen.tv-viewer', function () { finish(null, input); }, function () {
          finish({ message: 'The input was selected, but the TV viewer could not open.', detail: 'Use the remote’s Source control to view the input.' });
        });
      } catch (err) { finish({ message: 'The input was selected, but the TV viewer could not open.' }); }
    }
    if (port === 5 && ipConfigured) { selectIp(); return; }
    sources(function (err, list) {
      if (finished) return;
      if (err) { finish(err); return; }
      var input = null;
      list.some(function (item) { if (item.number === port) { input = item; return true; } return false; });
      if (!input) { finish({ message: 'This HDMI input is no longer available.' }); return; }
      if (port === 5 && input.ipControl) { selectIp(); return; }
      if (!input.source) {
        finish({ message: 'HDMI 5 is not reported by the TV.', detail: input.detail });
        return;
      }
      function rejected(error) {
        if (port === 5) {
          knownHdmi5 = null;
          finish({ message: 'The TV could not switch to HDMI 5.', detail: error && (error.message || error.name) || 'Select the PS5 in Samsung Home and return to CleanFrame.' });
        }
        else finish(failure(error));
      }
      try {
        tvw.setSource(input.source, function (selected) {
          if (finished) return;
          if (selected && (selected.type !== 'HDMI' || selected.number !== port)) { finish({ message: 'The TV selected a different input. Please try again.' }); return; }
          openViewer(input);
        }, function (error) { if (!finished) rejected(error); });
      } catch (error) { rejected(error); }
    });
  }
  // HbbTV handoff follows AeroTizen PR #1; retained MIT notice: licenses/AeroTizen-LICENSE.txt.
  function hbbtvLink(id) {
    try {
      if (typeof api().getAppMetaData !== 'function') return '';
      var metadata = api().getAppMetaData(id), i, item;
      if (!Array.isArray(metadata)) return '';
      for (i = 0; i < metadata.length; i++) {
        item = metadata[i];
        if (item && item.key === 'http://samsung.com/tv/metadata/hbbtv.link'
          && typeof item.value === 'string' && item.value.trim()) return item.value;
      }
    } catch (err) { /* Metadata may be unavailable on older TVs; retain ordinary launch. */ }
    return '';
  }
  function launchApp(id, done) {
    if (id === 'cleanframe.hdmi4' || id === 'cleanframe.hdmi5') { setSource(Number(id.slice(-1)), done); return; }
    if (!api()) { unavailable(done); return; }
    var finish = bounded(done), link = hbbtvLink(id);
    try {
      if (link) {
        var data = [
          new tizen.ApplicationControlData('tizenid', [id]),
          new tizen.ApplicationControlData('hbbtv', [link]),
          new tizen.ApplicationControlData('deeplink', ['true'])
        ];
        var control = new tizen.ApplicationControl('http://tizen.org/appcontrol/operation/default', null, null, null, data);
        api().launchAppControl(control, 'org.tizen.hbbtv', function () { finish(null); }, function (err) { finish(failure(err)); });
      } else api().launch(id, function () { finish(null); }, function (err) { finish(failure(err)); });
    } catch (err) { finish(failure(err)); }
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
          if (a.id === self || a.id === self.split('.')[0] + '.IpControl' || INTERNAL.indexOf(a.id) >= 0 || seen[a.id] || !a.name || (!primary && !stream && (!a.show || !consumer))) return;
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
