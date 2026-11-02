'use strict';
const fs=require('fs'),path=require('path'),cp=require('child_process');
const root=path.resolve(process.argv[2]||''),output=process.argv[3]&&path.resolve(process.argv[3]);
if(!process.argv[2]||!output)throw Error('Usage: node integrations/vetro/prepare.cjs VETRO_SOURCE UNSIGNED_OUTPUT.wgt');
const pin='fb1cadc66ff52cd86358b751e17c1cfb225e0733';
if(cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()!==pin)throw Error('Vetro revision differs; stop and review before patching.');
const file=path.join(root,'app/service/main.js'),routeFile=path.join(root,'app/service/cleanframe-bbc.js');
const original=cp.execFileSync('git',['show','HEAD:app/service/main.js'],{cwd:root,encoding:'utf8'});
const anchor='http.createServer(function (req, res) {';
if(original.split(anchor).length!==2)throw Error('Expected Vetro HTTP server not found exactly once.');
const hook=`var cleanFrameBBC = require('./cleanframe-bbc.js')({
    launch: function () {
        return inventory(false).then(function (data) {
            if (!data.apps.some(function (app) { return app.appId === 'DqEoaplKlw.bbchybrid'; })) throw new Error('BBC iPlayer is not installed');
            return runActions([{type: 'launch', appId: 'DqEoaplKlw.bbchybrid'}]);
        });
    }
});
http.createServer(function (req, res) {
    if (cleanFrameBBC(req, res)) return;`;
const patched=original.replace(anchor,hook),current=fs.readFileSync(file,'utf8');
if(current!==original&&current!==patched)throw Error('Vetro main.js has other edits; nothing changed.');
const route=fs.readFileSync(path.join(__dirname,'cleanframe-bbc.js'),'utf8');
if(fs.existsSync(routeFile)&&fs.readFileSync(routeFile,'utf8')!==route)throw Error('Existing integration differs; nothing changed.');
const backup=path.join(root,'.local/cleanframe-bbc-original-main.js');
fs.mkdirSync(path.dirname(backup),{recursive:true});
if(!fs.existsSync(backup))fs.writeFileSync(backup,original,{flag:'wx'});
fs.writeFileSync(routeFile,route);fs.writeFileSync(file,patched);
const files=require(path.join(root,'rooting/build.cjs')).collectIntegration();
const data=require(path.join(root,'app/build.cjs')).zip(files);
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,data);
console.log('Prepared full Vetro integration (unsigned): '+output);
console.log('No TV was contacted. No certificates or installed apps were changed.');
