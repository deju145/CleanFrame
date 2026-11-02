// Test the production adapter with a synthetic API and clock. No TV access.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../app/device.js', import.meta.url), 'utf8');
function harness({ supported = true, throwSource = false, websocket = true, storageBlocked = false, storedToken = null } = {}) {
  let now = 0, next = 0;
  const timers = new Map(), requests = [], launches = [], sourceRequests = [], changes = [];
  let current = { type: 'HDMI', number: 2 };
  const application = {
    getCurrentApplication: () => ({ appInfo: { id: 'Owner12345.Home' } }),
    getAppsInfo: (ok, fail) => requests.push({ ok, fail }),
    launch: (id, ok, fail) => launches.push({ id, ok, fail })
  };
  const sockets = [], storage = new Map();
  if(storedToken)storage.set('cleanframe.samsung.remote.v1',JSON.stringify(storedToken));
  function Socket(url){this.url=url;this.sent=[];this.closed=false;sockets.push(this);}
  Socket.prototype.send=function(text){this.sent.push(JSON.parse(text));};
  Socket.prototype.close=function(){this.closed=true;};
  Socket.prototype.event=function(event,data){if(this.onmessage)this.onmessage({data:JSON.stringify({event,data})});};
  const requestsHTTP = [];
  function XHR() { requestsHTTP.push(this); }
  XHR.prototype.open = function (method, url) { this.method = method; this.url = url; };
  XHR.prototype.send = function (body) { this.body = body; };
  const events = {};
  const window = { XMLHttpRequest: XHR, tizen: { application }, location: {origin:'null',protocol:'file:'},
    addEventListener: (name,handler) => {events[name]=handler;} };
  if(websocket)window.WebSocket=Socket;
  window.localStorage={getItem:key=>storage.get(key)||null,
    setItem:(key,value)=>{if(storageBlocked)throw Error('QuotaExceededError');storage.set(key,value);},
    removeItem:key=>storage.delete(key)};
  if (supported) {
    window.tizen.systeminfo = { getPropertyValue: (name, ok, fail) => { assert.equal(name, 'VIDEOSOURCE'); sourceRequests.push({ ok, fail }); } };
    window.tizen.tvwindow = { getSource: (...args) => { assert.equal(args.length, 0); return current; },
      setSource: (source, ok, fail) => { if (throwSource) throw Error('Synthetic SDK failure'); changes.push({ source, ok, fail }); } };
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
  return { device: window.FrameDevice, requests, launches, sourceRequests, changes, requestsHTTP, sockets, storage, events, advance, setCurrent: value => { current = value; } };
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
  assert.deepEqual(Array.from(result, x => x.number), [1, 2, 3]);
  assert.equal(result.find(x => x.number === 2).active, true);
  assert.equal(result.find(x => x.number === 2).connected, true);
  assert.equal(result.find(x => x.number === 1).connected, false);
});
test('input absence, denial, empty discovery and timeout never invent ports', () => {
  const absent = harness({ supported: false }); let error;
  absent.device.sources(e => { error = e; }); assert.ok(error);
  for (const mode of ['denied', 'empty', 'timeout']) {
    const h = harness(), results = [];
    h.device.sources((error, inputs) => results.push({ error, inputs }));
    if (mode === 'denied') h.sourceRequests[0].fail({ name: 'SecurityError' });
    else if (mode === 'empty') h.sourceRequests[0].ok({ connected: [], disconnected: [] });
    else h.advance(8000);
    assert.equal(results.length, 1);
    if (mode === 'empty') assert.equal(results[0].inputs.length, 0);
    else { assert.ok(results[0].error); assert.equal(results[0].inputs, undefined); }
    h.sourceRequests[0].ok(video); assert.equal(results.length, 1);
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

const remoteKey='cleanframe.samsung.remote.v1';
const remoteApps={data:[{appId:'320TESTBBC',name:'BBC iPlayer',app_type:2}]};
function approve(h,token='synthetic-token') {h.sockets[0].event('ms.channel.connect',{token});}
function remoteLaunches(socket){return socket.sent.filter(frame=>frame.params.event==='ed.apps.launch');}

test('BBC waits for Samsung authorization, then uses the discovered remote app ID and type', () => {
  const h=harness(),results=[];h.device.launchApp('DqEoaplKlw.bbchybrid',error=>results.push(error));
  const socket=h.sockets[0];
  assert.match(socket.url,/^ws:\/\/127\.0\.0\.1:8001\/api\/v2\/channels\/samsung.remote.control\?name=/);
  assert.equal(socket.sent.length,0);socket.event('ed.installedApp.get',remoteApps);assert.equal(socket.sent.length,0);
  approve(h);assert.equal(socket.sent[0].params.event,'ed.installedApp.get');
  assert.equal(JSON.parse(h.storage.get(remoteKey)).token,'synthetic-token');
  socket.event('ed.installedApp.get',remoteApps);socket.event('ed.installedApp.get',remoteApps);approve(h);
  const sent=remoteLaunches(socket);assert.equal(sent.length,1);
  assert.equal(sent[0].params.data.appId,'320TESTBBC');assert.equal(sent[0].params.data.action_type,'DEEP_LINK');
  assert.equal(results.length,0);h.advance(500);assert.deepEqual(results,[null]);assert.equal(socket.closed,true);
  assert.equal(h.requestsHTTP.length,0);assert.equal(h.launches.length,0);
});
test('BBC reuses only a matching saved token and stores rotated authorization', () => {
  const h=harness({storedToken:{origin:'http://127.0.0.1:8001',token:'old-token'}});
  h.device.launchApp('DqEoaplKlw.bbchybrid',()=>{});assert.match(h.sockets[0].url,/&token=old-token$/);
  approve(h,'new-token');assert.equal(JSON.parse(h.storage.get(remoteKey)).token,'new-token');
  for(const record of [{origin:'http://192.0.2.55:8001',token:'other-tv'}, {origin:'http://127.0.0.1:8001',token:'bad&token'}]){
    const other=harness({storedToken:record});other.device.launchApp('DqEoaplKlw.bbchybrid',()=>{});
    assert.ok(!other.sockets[0].url.includes('&token='));
  }
});
test('BBC denial clears the matching token, closes and never retries or submits a launch', () => {
  const h=harness({storedToken:{origin:'http://127.0.0.1:8001',token:'private-token'}}),results=[];
  h.device.launchApp('DqEoaplKlw.bbchybrid',error=>results.push(error));const socket=h.sockets[0];
  const late=socket.onmessage;socket.event('ms.channel.unauthorized',{});
  late({data:JSON.stringify({event:'ms.channel.connect',data:{token:'late-token'}})});
  assert.match(results[0].message,/denied remote access/);assert.ok(!JSON.stringify(results).includes('private-token'));
  assert.equal(h.storage.has(remoteKey),false);assert.equal(socket.closed,true);assert.equal(socket.sent.length,0);assert.equal(h.sockets.length,1);
});
test('BBC missing, ambiguous and malformed app lists never launch another application', () => {
  for(const data of [{data:[]},{data:[{name:'Other app',appId:'other',app_type:2}]},
    {data:[{name:'BBC iPlayer',appId:'one'},{name:'BBC iPlayer',appId:'two'}]},
    {data:[{name:'BBC iPlayer',appId:'bad/id'}]},'not-json',{}]){
    const h=harness();let error;h.device.launchApp('DqEoaplKlw.bbchybrid',value=>{error=value;});approve(h);
    h.sockets[0].event('ed.installedApp.get',data);assert.ok(error);assert.equal(remoteLaunches(h.sockets[0]).length,0);
  }
});
test('BBC exact native ID wins over name matches and native app types use NATIVE_LAUNCH', () => {
  const h=harness();h.device.launchApp('DqEoaplKlw.bbchybrid',()=>{});approve(h);
  h.sockets[0].event('ed.installedApp.get',JSON.stringify({data:[{appId:'DqEoaplKlw.bbchybrid',name:'BBC iPlayer',app_type:4},{appId:'other',name:'BBC iPlayer',app_type:2}]}));
  assert.equal(remoteLaunches(h.sockets[0])[0].params.data.appId,'DqEoaplKlw.bbchybrid');
  assert.equal(remoteLaunches(h.sockets[0])[0].params.data.action_type,'NATIVE_LAUNCH');
});
test('BBC timeout and cancellation close sockets and prevent late launches', () => {
  for(const cancel of [false,true]){
    const h=harness(),results=[];h.device.launchApp('DqEoaplKlw.bbchybrid',error=>results.push(error));
    const socket=h.sockets[0],late=socket.onmessage;
    if(cancel)h.device.cancelLaunch();else h.advance(35000);
    late({data:JSON.stringify({event:'ms.channel.connect',data:{token:'late'}})});
    assert.equal(results.length,1);assert.equal(socket.closed,true);assert.equal(socket.sent.length,0);
    if(!cancel)assert.match(results[0].message,/timed out/);
  }
});
test('BBC pending connection is cancelled when another app is launched', () => {
  const h=harness();h.device.launchApp('DqEoaplKlw.bbchybrid',()=>{});const old=h.sockets[0],late=old.onmessage;
  h.device.launchApp('org.tizen.netflix-app',()=>{});late({data:JSON.stringify({event:'ms.channel.connect',data:{}})});
  assert.equal(old.closed,true);assert.equal(old.sent.length,0);assert.equal(h.launches[0].id,'org.tizen.netflix-app');
});
test('BBC unsupported sockets, storage failures and malformed tokens do not launch', () => {
  const absent=harness({websocket:false});let error;absent.device.launchApp('DqEoaplKlw.bbchybrid',value=>{error=value;});assert.match(error.message,/unavailable/);
  for(const options of [{storageBlocked:true},{}]){
    const h=harness(options);h.device.launchApp('DqEoaplKlw.bbchybrid',value=>{error=value;});
    approve(h,options.storageBlocked?'valid-token':'invalid&token');assert.ok(error);assert.equal(h.sockets[0].sent.length,0);
  }
});
test('BBC protocol and transport errors finish once without exposing token-bearing socket URLs', () => {
  for(const event of ['ms.error','ms.channel.error','socket-error','socket-close']){
    const h=harness({storedToken:{origin:'http://127.0.0.1:8001',token:'never-show-this'}}),results=[];
    h.device.launchApp('DqEoaplKlw.bbchybrid',error=>results.push(error));const socket=h.sockets[0];
    if(event==='socket-error')socket.onerror({});else if(event==='socket-close')socket.onclose({code:1008});else socket.event(event,{token:'secret-response'});
    h.advance(40000);assert.equal(results.length,1);assert.ok(!JSON.stringify(results).includes('never-show-this'));
    assert.ok(!JSON.stringify(results).includes('secret-response'));assert.equal(socket.closed,true);
  }
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
