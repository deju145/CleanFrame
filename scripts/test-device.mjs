// Test the production adapter with a synthetic API and clock. No TV access.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../app/device.js', import.meta.url), 'utf8');
function harness({ supported = true, throwSource = false, metadata = [], noMetadata = false, metadataError = false, throwControl = false, arraySources = false } = {}) {
  let now = 0, next = 0;
  const timers = new Map(), requests = [], launches = [], sourceRequests = [], arrayRequests = [], changes = [], controls = [], metadataCalls = [];
  let current = { type: 'HDMI', number: 2 };
  const application = {
    getCurrentApplication: () => ({ appInfo: { id: 'Owner12345.Home' } }),
    getAppsInfo: (ok, fail) => requests.push({ ok, fail }),
    launch: (id, ok, fail) => launches.push({ id, ok, fail }),
    getAppMetaData: id => {metadataCalls.push(id);if(metadataError)throw Error('metadata denied');return typeof metadata==='function'?metadata(id):metadata;},
    launchAppControl: (control,id,ok,fail) => {controls.push({control,id,ok,fail});if(throwControl)throw Error('control denied');}

  };
  if(noMetadata)delete application.getAppMetaData;
  const sockets=[],requestsHTTP=[];
  const window = {tizen:{application,
    ApplicationControlData:function(key,value){this.key=key;this.value=value;},
    ApplicationControl:function(operation,uri,mime,category,data){Object.assign(this,{operation,uri,mime,category,data});}},
    WebSocket:function(){sockets.push({});throw Error('Unexpected network connection');},
    XMLHttpRequest:function(){requestsHTTP.push({});throw Error('Unexpected HTTP request');},
    localStorage:{getItem(){throw Error('Unexpected token read');},setItem(){throw Error('Unexpected token write');}}};
  if (supported) {
    const genuineSources = new WeakSet();
    window.tizen.systeminfo = { getPropertyValue: (name, ok, fail) => {
      assert.equal(name, 'VIDEOSOURCE');
      sourceRequests.push({ ok: video => {
        for (const list of [video && video.connected, video && video.disconnected]) {
          if (Array.isArray(list)) list.forEach(source => { if (source && typeof source === 'object') genuineSources.add(source); });
        }
        ok(video);
      }, fail });
    } };
    if (arraySources) window.tizen.systeminfo.getPropertyValueArray = (name, ok, fail) => {
      assert.equal(name, 'VIDEOSOURCE');
      arrayRequests.push({ ok: videos => {
        if (Array.isArray(videos)) for (const video of videos) for (const list of [video.connected, video.disconnected]) {
          if (Array.isArray(list)) list.forEach(source => genuineSources.add(source));
        }
        ok(videos);
      }, fail });
    };
    window.tizen.tvwindow = { getSource: (...args) => { assert.equal(args.length, 0); if (current) genuineSources.add(current); return current; },
      setSource: (source, ok, fail) => {
        if (!genuineSources.has(source)) throw TypeError('Cannot convert object to SystemInfoVideoSourceInfo');
        if (throwSource) throw Error('Synthetic SDK failure'); changes.push({ source, ok, fail });
      } };
  }
  vm.runInNewContext(source, {
    window, tizen: window.tizen,
    setTimeout: (callback, delay) => { const id = ++next; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout: id => timers.delete(id)
  });
  function advance(ms) {
    now += ms;
    for (const [id, timer] of timers) if (timer.at <= now) { timers.delete(id); timer.callback(); }
  }
  return { device: window.FrameDevice, requests, launches, sourceRequests, arrayRequests, changes, requestsHTTP, sockets, controls, metadataCalls, advance, setCurrent: value => { current = value; } };
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

const video = { connected: [{ type: 'HDMI', number: 2 }], disconnected: [{ type: 'HDMI', number: 1 }, { type: 'HDMI', number: 3 }] };
test('inputs use actual connected and sleeping source records and synchronous active status', () => {
  const h = harness(); let result;
  h.device.sources((error, inputs) => { assert.equal(error, null); result = inputs; });
  h.sourceRequests[0].ok({ connected: video.connected, disconnected: [...video.disconnected, { type: 'HDMI', number: 2 }, { type: 'TV', number: 0 }] });
  assert.deepEqual(Array.from(result, x => x.number), [1, 2, 3, 5]);
  assert.equal(result.find(x => x.number === 2).active, true);
  assert.equal(result.find(x => x.number === 2).connected, true);
  assert.equal(result.find(x => x.number === 1).connected, false);
});
test('input absence, denial and timeout remain errors; empty discovery offers only explicit manual HDMI 5', () => {
  const absent = harness({ supported: false }); let error;
  absent.device.sources(e => { error = e; }); assert.ok(error);
  for (const mode of ['denied', 'empty', 'timeout']) {
    const h = harness(), results = [];
    if (mode === 'empty') h.setCurrent(null);
    h.device.sources((error, inputs) => results.push({ error, inputs }));
    if (mode === 'denied') h.sourceRequests[0].fail({ name: 'SecurityError' });
    else if (mode === 'empty') h.sourceRequests[0].ok({ connected: [], disconnected: [] });
    else h.advance(8000);
    assert.equal(results.length, 1);
    if (mode === 'empty') {
      assert.deepEqual(Array.from(results[0].inputs, x => x.number), [5]);
      assert.equal(results[0].inputs[0].manual, true);
      assert.equal(results[0].inputs[0].connected, false);
    }
    else { assert.ok(results[0].error); assert.equal(results[0].inputs, undefined); }
    h.sourceRequests[0].ok(video); assert.equal(results.length, 1);
  }
});
test('unreported HDMI 5 never sends a plain object to the native API', () => {
  const h = harness(), results = [];
  h.device.launchApp('cleanframe.hdmi5', error => results.push(error));
  h.sourceRequests[0].ok(video);
  assert.equal(h.changes.length, 0);
  assert.equal(h.launches.length, 0);
  assert.equal(results.length, 1);
  assert.match(results[0].message, /not reported/);
  assert.match(results[0].detail, /Reported HDMI inputs: 1, 2, 3/);
  assert.match(results[0].detail, /Current source: HDMI 2/);
});
test('array discovery selects genuine HDMI 5 from a second source provider', () => {
  const h = harness({ arraySources: true }), native5 = { type: 'HDMI', number: 5 }, results = [];
  h.device.launchApp('cleanframe.hdmi5', error => results.push(error));
  assert.equal(h.sourceRequests.length, 0);
  h.arrayRequests[0].ok([video, { connected: [native5], disconnected: [] }]);
  assert.equal(h.changes[0].source, native5);
  h.changes[0].ok(native5); h.launches[0].ok();
  assert.deepEqual(results, [null]);
});
test('unsupported or empty array discovery falls back once without losing native identity', () => {
  for (const mode of ['unsupported', 'empty']) {
    const h = harness({ arraySources: true });
    h.device.setSource(2, () => {});
    if (mode === 'unsupported') h.arrayRequests[0].fail({ name: 'NotSupportedError' });
    else h.arrayRequests[0].ok([]);
    h.arrayRequests[0].fail({ name: 'NotSupportedError' });
    assert.equal(h.sourceRequests.length, 1);
    h.sourceRequests[0].ok(video);
    assert.equal(h.changes[0].source, video.connected[0]);
    assert.equal(h.changes.length, 1);
  }
});
test('late array discovery cannot select an input after cancellation or timeout', () => {
  for (const mode of ['cancel', 'timeout']) {
    const h = harness({ arraySources: true });
    h.device.setSource(5, () => {});
    if (mode === 'cancel') h.device.cancelSource(); else h.advance(8000);
    h.arrayRequests[0].ok([{ connected: [{ type: 'HDMI', number: 5 }], disconnected: [] }]);
    assert.equal(h.changes.length, 0);
    assert.equal(h.launches.length, 0);
  }
});
test('unresponsive array discovery falls back without letting its late result select a source', () => {
  const h = harness({ arraySources: true });
  h.device.setSource(2, () => {});
  h.advance(2000);
  assert.equal(h.sourceRequests.length, 1);
  h.arrayRequests[0].ok([{ connected: [{ type: 'HDMI', number: 5 }], disconnected: [] }]);
  assert.equal(h.changes.length, 0);
  h.sourceRequests[0].ok(video);
  assert.equal(h.changes.length, 1);
  assert.equal(h.changes[0].source, video.connected[0]);
});
test('current HDMI 5 omitted by enumeration retains its genuine source and waits for the viewer', () => {
  const h = harness(), results = [];
  const current = { type: 'HDMI', number: 5 };
  h.setCurrent(current);
  h.device.launchApp('cleanframe.hdmi5', (error, input) => results.push({ error, input }));
  h.sourceRequests[0].ok(video);
  assert.equal(h.changes.length, 1);
  assert.equal(h.changes[0].source.type, 'HDMI');
  assert.equal(h.changes[0].source.number, 5);
  assert.equal(h.changes[0].source, current);
  h.changes[0].ok({ type: 'HDMI', number: 5 });
  assert.equal(results.length, 0);
  assert.equal(h.launches[0].id, 'org.tizen.tv-viewer');
  h.launches[0].ok();
  assert.equal(results[0].error, null);
  assert.equal(results[0].input.active, true);
  assert.notEqual(results[0].input.manual, true);
});
test('a genuine HDMI 5 record can be reused after another input becomes current', () => {
  const h = harness(), current = { type: 'HDMI', number: 5 };
  h.setCurrent(current);
  h.device.sources(() => {}); h.sourceRequests[0].ok(video);
  h.setCurrent({ type: 'HDMI', number: 1 });
  h.device.launchApp('cleanframe.hdmi5', () => {}); h.sourceRequests[1].ok(video);
  assert.equal(h.changes[0].source, current);
});
test('enumerated HDMI 5 remains a real record and is not duplicated or marked manual', () => {
  const h = harness(); let inputs;
  const reported = { type: 'HDMI', number: 5, signal: 'extra vendor data' };
  h.device.sources((error, value) => { assert.equal(error, null); inputs = value; });
  h.sourceRequests[0].ok({ connected: [reported], disconnected: [reported] });
  const port5 = inputs.filter(input => input.number === 5);
  assert.equal(port5.length, 1);
  assert.equal(port5[0].source, reported);
  assert.equal(port5[0].connected, true);
  assert.notEqual(port5[0].manual, true);
});
test('genuine current HDMI 5 rejection never launches the viewer or reports success', () => {
  for (const mode of ['rejected', 'throw', 'different', 'cancel', 'timeout']) {
    const h = harness({ throwSource: mode === 'throw' }), results = [];
    h.setCurrent({ type: 'HDMI', number: 5 });
    h.device.launchApp('cleanframe.hdmi5', error => results.push(error));
    h.sourceRequests[0].ok(video);
    if (mode === 'rejected') h.changes[0].fail({ name: 'NotSupportedError' });
    else if (mode === 'different') h.changes[0].ok({ type: 'HDMI', number: 4 });
    else if (mode === 'cancel') { h.device.cancelSource(); h.changes[0].ok({ type: 'HDMI', number: 5 }); }
    else if (mode === 'timeout') { h.advance(8000); h.changes[0].ok({ type: 'HDMI', number: 5 }); }
    assert.equal(results.length, 1);
    assert.ok(results[0]);
    assert.equal(h.launches.length, 0);
    if (mode === 'rejected' || mode === 'throw') assert.match(results[0].message, /could not switch to HDMI 5/);
  }
});
test('input switching uses a discovered disconnected record and completes only after viewer launch', () => {
  const h = harness(), results = [];
  h.device.setSource(1, (error, input) => results.push({ error, input }));
  h.sourceRequests[0].ok(video);
  assert.equal(h.changes[0].source, video.disconnected[0]);
  h.changes[0].ok(video.disconnected[0]); assert.equal(results.length, 0);
  assert.equal(h.launches[0].id, 'org.tizen.tv-viewer');
  h.launches[0].ok(); assert.equal(results[0].error, null);
  assert.equal(results[0].input.number, 1);
});
test('source and viewer failures are errors and never hide the launcher', () => {
  for (const mode of ['source', 'throw', 'viewer', 'different']) {
    const h = harness({ throwSource: mode === 'throw' }), results = [];
    h.device.setSource(2, error => results.push(error));
    if (mode === 'throw') {
      h.sourceRequests[0].ok(video);
    } else {
      h.sourceRequests[0].ok(video);
      if (mode === 'source') h.changes[0].fail({ name: 'SecurityError' });
      else if (mode === 'different') h.changes[0].ok({ type: 'HDMI', number: 3 });
      else { h.changes[0].ok(video.connected[0]); h.launches[0].fail({ name: 'NotFoundError' }); }
    }
    assert.equal(results.length, 1); assert.ok(results[0]);
    assert.equal(h.launches.length, mode === 'viewer' ? 1 : 0);
  }
});
test('cancelled and timed-out input requests cannot initiate later device operations', () => {
  for (const mode of ['timeout', 'cancel']) {
    const h = harness(), results = [];
    h.device.setSource(2, error => results.push(error));
    if (mode === 'timeout') h.advance(8000); else h.device.cancelSource();
    assert.equal(results.length, 1); assert.ok(results[0]);
    h.sourceRequests[0].ok(video); assert.equal(h.changes.length, 0); assert.equal(h.launches.length, 0);
    const pending = harness(); pending.device.setSource(2, () => {}); pending.sourceRequests[0].ok(video);
    if (mode === 'timeout') pending.advance(8000); else pending.device.cancelSource();
    pending.changes[0].ok(video.connected[0]); assert.equal(pending.launches.length, 0);
  }
});
test('unknown and invalid ports cannot be substituted and a newer request cancels the old one', () => {
  for (const port of [-1, 1.5, '2', Infinity, 4]) {
    const h = harness(), results = []; h.device.setSource(port, error => results.push(error));
    if (port === 4) h.sourceRequests[0].ok(video);
    assert.equal(results.length, 1); assert.ok(results[0]); assert.equal(h.changes.length, 0);
  }
  const h = harness(), results = [];
  h.device.setSource(1, error => results.push(error)); h.device.setSource(2, () => {});
  assert.equal(results[0].cancelled, true);
  h.sourceRequests[0].ok(video); assert.equal(h.changes.length, 0);
  h.sourceRequests[1].ok(video); assert.equal(h.changes[0].source.number, 2);
});

const metadataKey='http://samsung.com/tv/metadata/hbbtv.link';
const bbcId='DqEoaplKlw.bbchybrid';
const bbcLink='https://www.live.bbctvapps.co.uk/tap/iplayer_@FHD';
const plain=value=>JSON.parse(JSON.stringify(value));

test('BBC uses installed metadata to launch the shared HbbTV host with all three required fields', () => {
  const h=harness({metadata:[{key:metadataKey,value:bbcLink}]}),results=[];
  h.device.launchApp(bbcId,error=>results.push(error));
  assert.deepEqual(h.metadataCalls,[bbcId]);assert.equal(h.controls.length,1);
  const request=h.controls[0];assert.equal(request.id,'org.tizen.hbbtv');
  assert.deepEqual(plain(request.control),{operation:'http://tizen.org/appcontrol/operation/default',uri:null,mime:null,category:null,
    data:[{key:'tizenid',value:[bbcId]},{key:'hbbtv',value:[bbcLink]},{key:'deeplink',value:['true']}]});
  assert.equal(h.launches.length,0);assert.equal(h.sockets.length,0);assert.equal(h.requestsHTTP.length,0);
  request.ok();assert.deepEqual(results,[null]);
});
test('HbbTV launch reads metadata afresh and supports other selected wrappers without guessing a URL', () => {
  const links={'Other12345.Hybrid':'https://example.invalid/hybrid?content=123', [bbcId]:bbcLink};
  const h=harness({metadata:id=>[{key:metadataKey,value:links[id]}]});
  for(const id of Object.keys(links)){h.device.launchApp(id,()=>{});h.controls[h.controls.length-1].ok();}
  assert.deepEqual(h.metadataCalls,Object.keys(links));
  for(const [i,id] of Object.keys(links).entries())assert.equal(h.controls[i].control.data[1].value[0],links[id]);
  assert.equal(h.launches.length,0);
});
test('Missing, empty, denied or unavailable HbbTV metadata preserves the normal launch path', () => {
  const cases=[{noMetadata:true},{metadataError:true},...[
    [],null,undefined,[null],{},'invalid',[{key:metadataKey,value:''}],
    [{key:metadataKey,value:'  '}],[{key:metadataKey,value:42}],
    [{key:'unrelated.link',value:'https://example.invalid'}]
  ].map(metadata=>({metadata}))];
  for(const options of cases){
    const h=harness(options),results=[];h.device.launchApp(bbcId,error=>results.push(error));
    assert.equal(h.controls.length,0);assert.equal(h.launches[0].id,bbcId);h.launches[0].ok();assert.deepEqual(results,[null]);
    assert.equal(h.requestsHTTP.length,0);assert.equal(h.sockets.length,0);
  }
});
test('HbbTV rejection and synchronous SDK failure are reported once without a second launch attempt', () => {
  for(const throwControl of [false,true]){
    const h=harness({metadata:[{key:metadataKey,value:bbcLink}],throwControl}),results=[];
    h.device.launchApp(bbcId,error=>results.push(error));
    if(!throwControl){h.controls[0].fail({name:'SecurityError',message:'host denied'});h.controls[0].ok();}
    assert.equal(results.length,1);assert.ok(results[0]);assert.equal(h.launches.length,0);assert.equal(h.controls.length,1);
  }
});
test('HbbTV keeps the bounded eight-second launch deadline and ignores late callbacks', () => {
  const h=harness({metadata:[{key:metadataKey,value:bbcLink}]}),results=[];
  h.device.launchApp(bbcId,error=>results.push(error));h.advance(8000);
  h.controls[0].ok();h.controls[0].fail({message:'late rejection'});
  assert.equal(results.length,1);assert.match(results[0].message,/did not respond/);assert.equal(h.launches.length,0);
});
test('Ordinary streaming apps retain their direct Tizen launch', () => {
  const h=harness();h.device.launchApp('IkWsFHtOY9.Stremio',()=>{});
  assert.equal(h.launches[0].id,'IkWsFHtOY9.Stremio');assert.equal(h.controls.length,0);
});

test('UK package variants resolve to monochrome marks without discovery', () => {
  const h = harness();
  for (const [id, brand] of [
    ['IkWsFHtOY9.Stremio','stremio'], ['DqEoaplKlw.bbchybrid','bbciplayer'],
    ['OCaxbgg9v6.chfourctv','channel4'], ['OEvCiupaFR.ITVHub','itvx'], ['OfLpiC2MZQ.Player','stv']
  ]) assert.equal(h.device.brandForApp({appId:id}),brand);
  assert.equal(h.device.brandForApp({appId:'Unrelated1.Player'}),'');
});

test('dock HDMI shortcuts use the upstream sleeping-source and viewer route', () => {
  for (const port of [4,5]) {
    const h=harness(), results=[];
    h.device.launchApp('cleanframe.hdmi'+port,(error,input)=>results.push({error,input}));
    const sleeping={type:'HDMI',number:port};
    h.sourceRequests[0].ok({connected:[],disconnected:[sleeping]});
    assert.equal(h.changes[0].source,sleeping);
    h.changes[0].ok(sleeping);assert.equal(h.launches[0].id,'org.tizen.tv-viewer');
    h.launches[0].ok();assert.equal(results[0].error,null);
  }
});
test('cancelled dock input shortcuts cannot switch later', () => {
  const h=harness();h.device.launchApp('cleanframe.hdmi5',()=>{});h.device.cancelSource();
  h.sourceRequests[0].ok({connected:[{type:'HDMI',number:5}]});
  assert.equal(h.changes.length,0);assert.equal(h.launches.length,0);
});
