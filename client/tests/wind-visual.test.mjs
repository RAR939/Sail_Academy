import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
const source = stripTypeScriptTypes(await readFile(new URL('../src/gameplay/WindVisual.ts', import.meta.url),'utf8'), {mode:'transform'});
const { apparentWindFlow, sailSideForWind } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
test('wind from north flows south; forward speed increases apparent headwind', () => {
  const wind = apparentWindFlow(0, 5, 0, 0); assert.ok(Math.abs(wind.x) < 1e-10); assert.equal(wind.z, -5);
  assert.equal(apparentWindFlow(0, 5, 0, 3).z, -8);
});
test('beam wind changes with boat movement and boom side keeps hysteresis', () => {
  const wind = apparentWindFlow(Math.PI/2, 5, 0, 2); assert.ok(Math.abs(wind.x+5)<1e-9); assert.ok(Math.abs(wind.z+2)<1e-9);
  assert.equal(sailSideForWind(0.02, 0, -1), -1); assert.equal(sailSideForWind(0.3, 0, -1), 1); assert.equal(sailSideForWind(-0.3, 0, 1), -1);
});
