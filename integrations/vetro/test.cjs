'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const create=require('./cleanframe-bbc.js');
function request(handler,{address='127.0.0.1',origin='null',method='POST',url='/cleanframe/bbciplayer'}={}){
 return new Promise(resolve=>{let status,headers={};
 const handled=handler({url,method,headers:{origin},socket:{remoteAddress:address},resume(){}},
 {setHeader:(key,value)=>{headers[key]=value;},writeHead:(s,h)=>{status=s;Object.assign(headers,h);},
 end:body=>resolve({handled:true,status,headers,body:body?JSON.parse(body):null})});
 if(!handled)resolve({handled:false});});
}
test('route acknowledges fixed native launch and permits widget origin',async()=>{
 let calls=0;const handler=create({launch:()=>{calls++;return{ok:true,sent:1};}});
 const r=await request(handler);assert.equal(r.status,200);assert.equal(r.body.appId,'DqEoaplKlw.bbchybrid');
 assert.equal(r.headers['Access-Control-Allow-Origin'],'null');assert.equal(calls,1);
});
test('route rejects network callers, foreign origins and non-POST requests',async()=>{
 let calls=0;const handler=create({launch:()=>{calls++;}});
 assert.equal((await request(handler,{address:'192.0.2.10'})).status,403);
 assert.equal((await request(handler,{origin:'https://example.com'})).status,403);
 assert.equal((await request(handler,{method:'GET'})).status,405);
 assert.equal((await request(handler,{method:'OPTIONS'})).status,204);
 assert.equal(calls,0);
});
test('other Vetro routes are untouched and unavailable root is reported',async()=>{
 const handler=create({launch:()=>Promise.reject(new Error('no root agent connected'))});
 assert.equal((await request(handler,{url:'/apps'})).handled,false);
 const r=await request(handler);assert.equal(r.status,503);assert.match(r.body.error,/no root/);
});
