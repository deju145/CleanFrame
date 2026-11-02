// Test the production adapter with a synthetic API and clock. No TV access.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../app/device.js', import.meta.url), 'utf8');
function harness(tvwindow) {
  let now = 0, next = 0;
  const timers = new Map(), requests = [], launches = [], controls = [];
  const application = {
    getCurrentApplication: () => ({ appInfo: { id: 'Owner12345.Home' } }),
    getAppsInfo: (ok, fail) => requests.push({ ok, fail }),
    launch: (id, ok, fail) => launches.push({ id, ok, fail }),
    launchAppControl: (control, id, ok, fail) => controls.push({ control, id, ok, fail })
  };
  const sourceRequests = [];
  const requestsHTTP = [];
  function XHR() { requestsHTTP.push(this); }
  XHR.prototype.open = function (method, url) { this.method = method; this.url = url; };
  XHR.prototype.send = function (body) { this.body = body; };
  const window = { XMLHttpRequest: XHR, tizen: { application, tvwindow, systeminfo: {getPropertyValue: (name, ok, fail) => sourceRequests.push({name, ok, fail})}, ApplicationControl: function(operation) { this.operation = operation; } } };
  vm.runInNewContext(source, {
    window, tizen: window.tizen,
    setTimeout: (callback, delay) => { const id = ++next; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout: id => timers.delete(id)
  });
  function advance(ms) {
    now += ms;
    for (const [id, timer] of timers) if (timer.at <= now) { timers.delete(id); timer.callback(); }
  }
  return { device: window.FrameDevice, requests, launches, controls, sourceRequests, requestsHTTP, advance };
}

test('a 500-app catalogue can arrive after the old eight-second deadline', () => {
  const h = harness(), results = [];
  h.device.apps((error, apps) => results.push({ error, apps }));
  assert.equal(h.requests.length, 1);
  h.advance(15000);
  assert.equal(results.length, 0);
  h.requests[0].ok(Array.from({ length: 500 }, (_, i) => ({ id: 'App' + String(i).padStart(7, '0') + '.Consumer', name: 'App ' + i, show: true })));
  assert.equal(results.length, 1);
  assert.equal(results[0].error, null);
  assert.equal(results[0].apps.length, 502);
});

test('catalogue timeout and late callbacks finish only once', () => {
  const h = harness(), results = [];
  h.device.apps((error, apps) => results.push({ error, apps }));
  h.advance(19999);
  assert.equal(results.length, 0);
  h.advance(1);
  assert.equal(results.length, 1);
  assert.match(results[0].error.message, /did not respond/);
  h.requests[0].ok([]);
  h.requests[0].fail({ message: 'Late failure' });
  assert.equal(results.length, 1);
});

test('regional streaming apps stay distinct and system helpers stay hidden', () => {
  const h = harness();
  let apps;
  h.device.apps((error, value) => { assert.equal(error, null); apps = value; });
  h.requests[0].ok([
    { id: 'Owner12345.Home', name: 'My Home', show: true },
    { id: '9Ur5IzDKqV.TizenYouTube', name: 'YouTube', show: false },
    { id: 'PvWgqxV3Xa.YouTubeTV', name: 'YouTube TV', show: false },
    { id: 'cj37Ni3qXM.HBONow', name: 'HBO Max', show: false },
    { id: '2022ePop01.SmartTV', name: 'Smart TV', show: true },
    { id: 'd0m1lV1nt2.emanual', name: 'User Guide', show: true },
    { id: 'Hidden1234.Consumer', name: 'Hidden app', show: false }
  ]);
  assert.equal(apps.length, 5);
  assert.equal(apps.find(a => a.name === 'YouTube').brand, 'youtube');
  assert.equal(apps.find(a => a.name === 'YouTube TV').brand, '');
  assert.equal(apps.find(a => a.name === 'HBO Max').brand, 'hbomax');
});

test('launch keeps its eight-second deadline independently of discovery', () => {
  const h = harness(), results = [];
  h.device.launchApp('Synthetic.App', error => results.push(error));
  h.advance(8000);
  assert.equal(results.length, 1);
  assert.match(results[0].message, /did not respond/);
  h.launches[0].ok();
  assert.equal(results.length, 1);
});

test('BBC requests the fixed loopback relay rather than the public app API', () => {
  const h = harness(), results = [];
  h.device.launchApp('DqEoaplKlw.bbchybrid', error => results.push(error));
  assert.equal(h.launches.length,0); assert.equal(h.controls.length,0);
  const xhr = h.requestsHTTP[0];
  assert.equal(xhr.method,'POST'); assert.equal(xhr.url,'http://127.0.0.1:28199/launch/bbciplayer');
  xhr.status=200; xhr.responseText=JSON.stringify({ok:true,appId:'DqEoaplKlw.bbchybrid'}); xhr.onload();
  assert.deepEqual(results,[null]);
});
test('BBC reports bridge failures and cannot accept late success after timeout', () => {
  const h = harness(), results = [];
  h.device.launchApp('DqEoaplKlw.bbchybrid', error => results.push(error));
  h.requestsHTTP[0].onerror();
  assert.match(results[0].message,/not reachable/);
  const late=harness(), timeouts=[];
  late.device.launchApp('DqEoaplKlw.bbchybrid', error => timeouts.push(error));
  late.advance(20000);
  late.requestsHTTP[0].status=200;
  late.requestsHTTP[0].responseText=JSON.stringify({ok:true,appId:'DqEoaplKlw.bbchybrid'});
  late.requestsHTTP[0].onload();
  assert.equal(timeouts.length,1); assert.match(timeouts[0].message,/did not respond/);
});
test('BBC rejects an unverified relay response', () => {
  const h=harness(); let error;
  h.device.launchApp('DqEoaplKlw.bbchybrid', value => {error=value;});
  h.requestsHTTP[0].status=200; h.requestsHTTP[0].responseText='{}'; h.requestsHTTP[0].onload();
  assert.match(error.message,/did not confirm/);
});
test('HDMI 5 selects the reported port, shows fullscreen and returns on close', () => {
  const calls = [], source = { type: 'HDMI', number: 5 };
  const h = harness({
    setSource: (value, ok) => { assert.equal(value, source); calls.push('source'); ok(); },
    show: (ok, fail, rect, window, position) => {
      assert.equal(Array.from(rect).join(','), '0%,0%,100%,100%');
      assert.equal(window, 'MAIN'); assert.equal(position, 'FRONT'); calls.push('show'); ok();
    },
    hide: ok => { calls.push('hide'); ok(); }
  });
  h.device.input(5, err => assert.equal(err, null));
  assert.equal(h.sourceRequests[0].name, 'VIDEOSOURCE');
  h.sourceRequests[0].ok({ connected: [{ type: 'HDMI', number: 4 }, source] });
  assert.equal(h.device.inputActive(), true);
  h.device.closeInput(err => assert.equal(err, null));
  assert.equal(h.device.inputActive(), false);
  assert.deepEqual(calls, ['source', 'show', 'hide']);
});

test('an absent HDMI port does not select another source', () => {
  const h = harness({ setSource: () => assert.fail('Unexpected source switch') });
  let error;
  h.device.input(5, err => { error = err; });
  h.sourceRequests[0].ok({ connected: [{ type: 'HDMI', number: 4 }] });
  assert.match(error.message, /HDMI 5 is not available/);
  assert.equal(h.device.inputActive(), false);
});

test('source discovery arriving after timeout cannot switch inputs', () => {
  const h = harness({ setSource: () => assert.fail('Late source switch') });
  let count = 0;
  h.device.input(5, () => { count++; });
  h.advance(8000);
  h.sourceRequests[0].ok({ connected: [{ type: 'HDMI', number: 5 }] });
  assert.equal(count, 1);
});


function sourcesPanel() {
  const main = readFileSync(new URL('../app/main.js', import.meta.url), 'utf8');
  const code = main.slice(main.indexOf('  V.sources = {'), main.indexOf('  V.settings = {'));
  const launches = [], context = {V: {}, popped: 0,
    clamp: (v, min, max) => Math.max(min, Math.min(v, max)),
    pop: () => { context.popped++; }, perform: (title, run) => run(() => {}),
    FrameDevice: {input: (number, done) => { launches.push(number); done(null); }}
  };
  vm.runInNewContext(code, context);
  return {panel: context.V.sources, context, launches};
}
test('Sources focus is bounded and only OK switches a port', () => {
  const h = sourcesPanel(), state = {f: {i: 0}};
  for (let i=0; i<8; i++) h.panel.key(state, 'down');
  assert.equal(state.f.i, 4);
  assert.deepEqual(h.launches, []);
  h.panel.key(state, 'ok');
  assert.deepEqual(h.launches, [5]);
  for (let i=0; i<8; i++) h.panel.key(state, 'up');
  assert.equal(state.f.i, 0);
  h.panel.key(state, 'back');
  assert.equal(h.context.popped, 1);
});
test('Sources pointer selection uses the selected HDMI number', () => {
  const h = sourcesPanel(), state = {f: {i: 0}};
  h.panel.point(state, 'row', 3);
  assert.deepEqual(h.launches, [4]);
});

test('UK package variants resolve to monochrome marks without discovery', () => {
  const h = harness();
  for (const [id, brand] of [
    ['IkWsFHtOY9.Stremio','stremio'], ['DqEoaplKlw.bbchybrid','bbciplayer'],
    ['OCaxbgg9v6.chfourctv','channel4'], ['OEvCiupaFR.ITVHub','itvx'], ['OfLpiC2MZQ.Player','stv']
  ]) assert.equal(h.device.brandForApp({appId:id}),brand);
  assert.equal(h.device.brandForApp({appId:'Unrelated1.Player'}),'');
});
test('LIVE TV dock shortcut selects HDMI 4 without launching an app', () => {
  const h = harness({setSource: (source, ok) => { assert.equal(source.number,4); ok(); },show: ok => ok()});
  let result = 'pending';
  h.device.launchApp('cleanframe.hdmi4', err => {result=err;});
  h.sourceRequests[0].ok({connected:[{type:'HDMI',number:4}]});
  assert.equal(result,null); assert.equal(h.launches.length,0);
});
