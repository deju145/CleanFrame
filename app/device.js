/* Public Tizen application APIs. No Mac server, network address or credentials. */
(function () {
  'use strict';
  var IDS = {
    bbciplayer: 'DqEoaplKlw', stvplayer: 'OfLpiC2MZQ',
    itvx: 'OEvCiupaFR', ch4: 'OCaxbgg9v6', ch5: 'EkzyZtmneG',
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
  function brandFor(a) {
    var brands = Object.keys(IDS), i, target;
    for (i = 0; i < brands.length; i++) {
      target = IDS[brands[i]];
      if (a.id === target || (target.indexOf('.') < 0 && (a.packageId === target || a.id.split('.')[0] === target))) return brands[i];
    }
    return '';
  }
  function launchApp(id, done) {
    if (/^[A-Za-z0-9]{10}$/.test(id)) { launchPackage(id, done); return; }
    launchNative(id, done);
  }
  function launchPackage(packageId, done) {
    if (!api()) { unavailable(done); return; }
    var finish = bounded(done), expired = false;
    // One deadline covers both discovery and launch. Late discovery must not launch.
    var guard = setTimeout(function () { expired = true; }, 8000);
    function complete(err) { clearTimeout(guard); expired = true; finish(err); }
    try {
      api().getAppsInfo(function (list) {
        if (expired) return;
        var matches = list.filter(function (a) { return a.packageId === packageId || a.id.split('.')[0] === packageId; });
        if (matches.length !== 1) {
          complete({ message: matches.length ? 'More than one app matches this shortcut.' : 'This app is not installed on the TV.' });
          return;
        }
        api().launch(matches[0].id, function () { complete(null); }, function (err) { complete(failure(err)); });
      }, function (err) { complete(failure(err)); });
    } catch (err) { complete(failure(err)); }
  }
  function launchNative(id, done) {
    if (!api()) { unavailable(done); return; }
    var finish = bounded(done);
    try { api().launch(id, function () { finish(null); }, function (err) { finish(failure(err)); }); }
    catch (err) { finish(failure(err)); }
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
          var brand = brandFor(a), primary = !!brand, stream = STREAMING.indexOf(a.id) >= 0;
          var consumer = /^[A-Za-z0-9]{10}\.[A-Za-z0-9_-]+$/.test(a.id) || CONSUMER_SYSTEM.indexOf(a.id) >= 0;
          if (a.id === self || INTERNAL.indexOf(a.id) >= 0 || seen[a.id] || !a.name || (!primary && !stream && (!a.show || !consumer))) return;
          if (!primary && /(?:service|worker|preview|promotion|plugin|launcher|test|sdk|^ep[ -]|factory|daemon)/i.test(a.name + ' ' + a.id)) return;
          if (/-dummy$/.test(a.id) || a.id === 'com.samsung.tv.cobalt-yt') return;
          seen[a.id] = true;
          result.push({ appId: a.id, name: a.name, brand: brand || EXTRA_BRANDS[a.id] || '', icon: a.iconPath || '', rank: primary ? Object.keys(IDS).indexOf(brand) : (stream ? 20 : 30) });
        });
        result.sort(function (a, b) { return a.rank - b.rank || a.name.toLowerCase().localeCompare(b.name.toLowerCase()); });
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
  window.FrameDevice = { input: input, inputActive: inputActive, closeInput: closeInput, launch: launch, launchApp: launchApp, art: art, home: home, settings: settings, apps: apps };
}());
