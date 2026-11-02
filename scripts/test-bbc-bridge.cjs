'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), vm=require('node:vm');
const {readFileSync}=require('node:fs'), {EventEmitter}=require('node:events');
const source=readFileSync(__dirname+'/vetro-bbc-bridge.cjs','utf8');
function harness(){
 let handler;const calls=[],state={status:200,payload:{ok:true,sent:1},unavailable:false};
 const fakeHttp={
  createServer:fn=>{handler=fn;return{};},
  request:(options,callback)=>{
   const req=new EventEmitter();req.setTimeout=()=>{};
   req.end=body=>{calls.push({options,body});queueMicrotask(()=>{
    if(state.unavailable){req.emit('error',new Error('offline'));return;}
    const response=new EventEmitter();response.statusCode=state.status;response.setEncoding=()=>{};response.destroy=()=>{};
    callback(response);response.emit('data',JSON.stringify(state.payload));response.emit('end');
   });};return req;
  }
 };
 const module={exports:{}};
 vm.runInNewContext(source,{require:name=>{assert.equal(name,'http');return fakeHttp;},module,Buffer,console});
 module.exports.createBridge(8099);
 function request(path='/launch/bbciplayer',method='POST',origin='null'){
  return new Promise(resolve=>{
   const req={url:path,method,headers:{origin},resume(){}},headers={};let status=200;
   const res={setHeader:(k,v)=>{headers[k]=v;},writeHead:(s,h)=>{status=s;Object.assign(headers,h);},
    end:body=>resolve({status,headers,body:body?JSON.parse(body):null})};
   handler(req,res);
  });
 }
 return{request,calls,state};
}
test('relay forwards only the exact BBC app and returns verified native acknowledgement',async()=>{
 const h=harness(),result=await h.request();
 assert.equal(result.status,200);assert.equal(result.headers['Access-Control-Allow-Origin'],'null');
 assert.equal(result.body.transport,'vetro-native');assert.equal(h.calls[0].options.hostname,'127.0.0.1');
 assert.equal(h.calls[0].options.path,'/apps/launch');
 assert.deepEqual(JSON.parse(h.calls[0].body),{appId:'DqEoaplKlw.bbchybrid'});
});
test('relay rejects arbitrary commands, other origins and incorrect methods without forwarding',async()=>{
 const h=harness();
 assert.equal((await h.request('/exec')).status,404);
 assert.equal((await h.request('/launch/bbciplayer','GET')).status,405);
 assert.equal((await h.request('/launch/bbciplayer','POST','https://example.com')).status,403);
 assert.equal(h.calls.length,0);
});
test('relay reports disconnected root and does not accept incomplete acknowledgement',async()=>{
 const h=harness();h.state.status=503;h.state.payload={error:'no root agent connected'};
 assert.match((await h.request()).body.error,/no root/);
 h.state.status=200;h.state.payload={ok:true,sent:0};
 assert.equal((await h.request()).status,503);
});
test('relay reports an unavailable Vetro service and supports widget preflight',async()=>{
 const h=harness();h.state.unavailable=true;
 assert.equal((await h.request()).status,503);
 const preflight=await h.request('/launch/bbciplayer','OPTIONS');
 assert.equal(preflight.status,204);
 assert.equal(preflight.headers['Access-Control-Allow-Origin'],'null');
});
