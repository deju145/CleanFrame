/* Public Tizen application APIs. No Mac server, network address or credentials. */
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
  function launchApp(id, done) {
    if (id === 'cleanframe.hdmi4' || id === 'cleanframe.hdmi5') { input(Number(id.slice(-1)), done); return; }
    if (!api()) { unavailable(done); return; }
    var finish = bounded(done, id === 'DqEoaplKlw.bbchybrid' ? 20000 : 8000);
    if (id === 'DqEoaplKlw.bbchybrid') { launchBBC(finish); return; }
    try { api().launch(id, function () { finish(null); }, function (err) { finish(failure(err)); }); }
    catch (err) { finish(failure(err)); }
  }
  function launchBBC(done) {
    if (!window.XMLHttpRequest) { done({message: 'BBC launch bridge is unavailable.'}); return; }
    var xhr = new window.XMLHttpRequest(), finished = false;
    function finish(error) { if (finished) return; finished = true; done(error); }
    try {
      xhr.open('POST', 'http://127.0.0.1:8099/cleanframe/bbciplayer', true);
      xhr.timeout = 18000;
      xhr.onload = function () {
        try {
          var result = JSON.parse(xhr.responseText);
          if (xhr.status === 200 && result.ok === true && result.appId === 'DqEoaplKlw.bbchybrid') finish(null);
          else finish({message: result.error || 'Vetro did not confirm the BBC launch.'});
        } catch (err) { finish({message: 'Invalid BBC bridge response.'}); }
      };
      xhr.onerror = function () { finish({message: 'Vetro BBC integration is not reachable.', detail: 'Open the custom Vetro build and wait for its root agent to connect.'}); };
      xhr.ontimeout = function () { finish({message: 'BBC launch timed out; check the TV before retrying.'}); };
      xhr.send(null);
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
  var showingInput = false;
  function inputActive() { return showingInput; }
  function closeInput(done) {
    if (!window.tizen || !tizen.tvwindow) { unavailable(done); return; }
    var finish = bounded(done);
    try {
      tizen.tvwindow.hide(function () { showingInput = false; finish(null); }, function (err) { finish(failure(err)); }, 'MAIN');
    } catch (err) { finish(failure(err)); }
  }
  function input(number, done) {
    if (!window.tizen || !tizen.systeminfo || !tizen.tvwindow) { unavailable(done); return; }
    var active = true;
    var finish = bounded(function (err) { active = false; done(err); });
    function failed(err) { if (active) finish(failure(err)); }
    try {
      tizen.systeminfo.getPropertyValue('VIDEOSOURCE', function (info) {
        if (!active) return;
        var sources = (info.connected || []).filter(function (source) { return source.type === 'HDMI' && Number(source.number) === number; });
        if (sources.length !== 1) {
          finish({ message: 'HDMI ' + number + ' is not available.', detail: 'Check the cable, device power and physical HDMI port number.' });
          return;
        }
        try {
          tizen.tvwindow.setSource(sources[0], function () {
            if (!active) return;
            try {
              tizen.tvwindow.show(function () {
                showingInput = true;
                if (active) finish(null);
              }, failed, ['0%', '0%', '100%', '100%'], 'MAIN', 'FRONT');
            } catch (err) { failed(err); }
          }, failed, 'MAIN');
        } catch (err) { failed(err); }
      }, failed);
    } catch (err) { failed(err); }
  }
  window.FrameDevice = { brandForApp: brandForApp, input: input, inputActive: inputActive, closeInput: closeInput, launch: launch, launchApp: launchApp, art: art, home: home, settings: settings, apps: apps };
}());
