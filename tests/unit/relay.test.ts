import { expect, test } from 'vitest';
import { FallbackRelay } from '../../src/viewer/relay.ts';

test('messages sent before and during a switch reach the fallback in order; none go to the dead primary', async () => {
  const primary: string[] = [];
  const fallback: string[] = [];
  const relay = new FallbackRelay<string>(m => primary.push(m));
  relay.send('init');
  relay.send('resize-1');
  let finishSwitch!: (send: (m: string) => void) => void;
  const switching = relay.switchTo(new Promise(resolve => { finishSwitch = resolve; }));
  relay.send('resize-2');                 // the phone rotates while the fallback engine downloads
  relay.send('visible');
  finishSwitch(m => fallback.push(m));
  await switching;
  relay.send('configure');
  expect(primary).toEqual(['init', 'resize-1']);
  expect(fallback).toEqual(['init', 'resize-1', 'resize-2', 'visible', 'configure']);
});

test('once the primary is confirmed, nothing is kept for replay', () => {
  const primary: string[] = [];
  const relay = new FallbackRelay<string>(m => primary.push(m));
  relay.send('init');
  relay.confirmPrimary();
  relay.send('move');
  expect(primary).toEqual(['init', 'move']);
  expect(relay.recorded).toBe(0);
});
