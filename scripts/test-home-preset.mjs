// Exercise the production preference migration without a browser or TV.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../app/main.js', import.meta.url), 'utf8');
const data = source.slice(source.indexOf('  var HOME_PRESET'), source.indexOf('  var WALLS'));
const preferences = source.slice(source.indexOf('  function safeId'), source.indexOf('  function initialise'));
const expected = ['stremio', 'livetv', 'ps5', 'bbciplayer', 'stvplayer', 'itvx', 'ch4', 'ch5'];
function harness() {
  const context = vm.createContext({});
  vm.runInContext(`
    var CAP = 9;
    ${data}
    var LOOK_VALUES = { bg: ['dark', 'light', 'photo'], layout: ['list', 'dock'], apps: ['icons', 'both', 'text'],
      controls: ['icons', 'both', 'text'], focus: ['type', 'glass'], material: ['soft', 'frost', 'tint'], font: ['manrope'] };
    var MODES = [{id:'fixed'}], WALLS = [{id:'misty'}];
    function pick(value, values, fallback) { return values.indexOf(value) >= 0 ? value : fallback; }
    function app(id) { return APPS.filter(function(a) { return a.id === id; })[0]; }
    function wall(id) { return id === 'misty'; }
    function lookOf(c) { return {bg:c.bg,layout:c.layout}; }
    ${preferences}
  `, context);
  return context;
}
test('fresh Home has the requested eight apps and HDMI targets', () => {
  const h = harness(), c = h.clean(null);
  assert.deepEqual(Array.from(c.home), expected);
  assert.equal(h.app('livetv').input, 4);
  assert.equal(h.app('ps5').input, 5);
});
test('existing preferences adopt the order once and retain appearance', () => {
  const h = harness(), c = h.clean({home:['stremio'], look:{bg:'dark', layout:'list'}});
  assert.deepEqual(Array.from(c.home), expected);
  assert.equal(c.bg, 'dark'); assert.equal(c.layout, 'list');
  const saved = h.serialise({...c, home:['ps5', 'stremio']});
  assert.deepEqual(Array.from(h.clean(saved).home), ['ps5', 'stremio']);
});
test('serialising a later edit retains the migration marker', () => {
  const h = harness(), c = h.clean(null);
  delete c.homePreset;
  const saved = h.serialise(c);
  assert.equal(saved.homePreset, 'uk-hdmi-v1');
});
