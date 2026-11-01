import test from 'node:test';
import assert from 'node:assert/strict';
import { PlayerChat } from '../src/ui/PlayerChat.ts';

class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.hidden = false; this.textContent = ''; this.listeners = {}; this.attributes = {}; this.value = ''; }
  append(...nodes) { for (const n of nodes) { n.parent = this; this.children.push(n); } }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  get childElementCount() { return this.children.length; }
  get firstElementChild() { return this.children[0] ?? null; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(n => n !== this); }
  focus() { this.focused = true; }
  fire(type, event = {}) { this.listeners[type]?.({ preventDefault() {}, stopPropagation() {}, ...event }); }
}

class MockNetwork {
  constructor() { this.handlers = new Map(); this.status = null; this.sent = []; }
  on(type, handler) { this.handlers.set(type, handler); return () => this.handlers.delete(type); }
  onStatus(handler) { this.status = handler; handler('disconnected'); return () => { this.status = null; }; }
  sendChat(text) { this.sent.push(text); }
  emit(type, value) { this.handlers.get(type)?.(value); }
}

test('chat renders safe text, sends to the room and clears on room changes', () => {
  const body = new Element('body');
  globalThis.document = { body, createElement: tag => new Element(tag), createTextNode: text => ({textContent: text}), exitPointerLock() {} };
  const network = new MockNetwork();
  const canvas = new Element('canvas');
  const chat = new PlayerChat(network, canvas);
  const root = body.children[0];
  const [panel, toggle] = root.children;
  const [, history, , form] = panel.children;
  const [input] = form.children;
  network.status('connected');
  network.emit('welcome', {user_id: 1, room: 'hub'});
  network.emit('chat', {roomId: 'hub', user_id: 2, username: '<b>Игрок</b>', text: '<img src=x>'});
  assert.equal(history.children.length, 1);
  assert.equal(history.children[0].children[0].textContent, '<b>Игрок</b>: ');
  assert.equal(history.children[0].children[1].textContent, '<img src=x>');
  assert.match(toggle.textContent, /1/);
  toggle.fire('click');
  assert.equal(panel.hidden, false);
  assert.equal(toggle.attributes['aria-expanded'], 'true');
  input.value = '  Привет!  ';
  form.fire('submit');
  assert.deepEqual(network.sent, ['Привет!']);
  network.emit('location_changed', {roomId: 'race_1'});
  assert.equal(history.children.length, 0);
  network.emit('chat', {roomId: 'hub', user_id: 2, username: 'old', text: 'old'});
  assert.equal(history.children.length, 0);
  network.status('disconnected');
  assert.equal(root.hidden, true);
  chat.dispose();
  assert.equal(body.children.length, 0);
  delete globalThis.document;
});
