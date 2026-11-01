// Test the production adapter with a synthetic API and clock. No TV access.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../app/device.js', import.meta.url), 'utf8');
function harness(tvwindow) {
  let now = 0, next = 0;
  const timers = new Map(), requests = [], launches = [];
  const application = {
    getCurrentApplication: () => ({ appInfo: { id: 'Owner12345.Home' } }),
    getAppsInfo: (ok, fail) => requests.push({ ok, fail }),
    launch: (id, ok, fail) => launches.push({ id, ok, fail })
  };
  const sourceRequests = [];
  const window = { tizen: { application, tvwindow, systeminfo: {
    getPropertyValue: (name, ok, fail) => sourceRequests.push({ name, ok, fail })
  } } };
  vm.runInNewContext(source, {
    window, tizen: window.tizen,
    setTimeout: (callback, delay) => { const id = ++next; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout: id => timers.delete(id)
  });
  function advance(ms) {
    now += ms;
    for (const [id, timer] of timers) if (timer.at <= now) { timers.delete(id); timer.callback(); }
  }
  return { device: window.FrameDevice, requests, launches, sourceRequests, advance };
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
  assert.equal(results[0].apps.length, 500);
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
  assert.equal(apps.length, 3);
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

test('a package prefix resolves to the installed application ID', () => {
  const h = harness(), results = [];
  h.device.launchApp('DqEoaplKlw', error => results.push(error));
  h.requests[0].ok([{ id: 'DqEoaplKlw.ActualRegionalApp', name: 'BBC iPlayer' }]);
  assert.equal(h.launches[0].id, 'DqEoaplKlw.ActualRegionalApp');
  h.launches[0].ok();
  assert.deepEqual(results, [null]);
});

test('missing and ambiguous packages never launch an arbitrary app', () => {
  for (const list of [[], [{ id: 'DqEoaplKlw.One' }, { id: 'DqEoaplKlw.Two' }]]) {
    const h = harness(), results = [];
    h.device.launchApp('DqEoaplKlw', error => results.push(error));
    h.requests[0].ok(list);
    assert.equal(h.launches.length, 0);
    assert.equal(results.length, 1);
    assert.ok(results[0].message);
  }
});

test('late package discovery cannot launch after timeout', () => {
  const h = harness(), results = [];
  h.device.launchApp('DqEoaplKlw', error => results.push(error));
  h.advance(8000);
  h.requests[0].ok([{ id: 'DqEoaplKlw.Player' }]);
  assert.equal(h.launches.length, 0);
  assert.equal(results.length, 1);
});

test('UK package prefixes are recognised in the installed catalogue', () => {
  const h = harness();
  let apps;
  h.device.apps((err, value) => { assert.equal(err, null); apps = value; });
  h.requests[0].ok([{ id: 'DqEoaplKlw.Player', name: 'BBC iPlayer', show: false }]);
  assert.equal(apps[0].brand, 'bbciplayer');
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

