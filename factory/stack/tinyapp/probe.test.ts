import {expect, test} from 'bun:test';
import {Aliases, failing, hollow, holds, probeFromPlan, type Content, type Probe} from './probe';

const E: Content = [{}, {}];
const ONE: Content = [{todos: {'0': {text: 'buy milk'}}}, {}];
const DONE: Content = [{todos: {'0': {text: 'buy milk', completed: true}}}, {}];

test('checks agree with probe_block.py', () => {
  expect(holds({table: 'todos', row: '0', cell: 'text', eq: 'buy milk'}, ONE)).toBe(true);
  expect(holds({table: 'todos', row: '0', cell: 'completed', absent: true}, ONE)).toBe(true);
  expect(holds({table: 'todos', row: '0', cell: 'completed', eq: true}, ONE)).toBe(false);
  expect(holds({table: 'todos', row: '0', cell: 'completed', eq: 1}, DONE)).toBe(false);
  expect(holds({table: 'todos', row: '0', absent: true}, E)).toBe(true);
  expect(holds({table: 'todos', row: '0', absent: true}, ONE)).toBe(false);
  expect(holds({value: 'k', absent: true}, E)).toBe(true);
  expect(holds({unchanged: true}, ONE, ONE)).toBe(true);
  expect(holds({unchanged: true}, DONE, ONE)).toBe(false);
});

test('hollow unless holds_before', () => {
  const p = {expect: [{table: 'todos', row: '0', cell: 'text', eq: 'buy milk'}]} as Probe;
  expect(hollow(p, ONE)).toBe(true);
  expect(hollow(p, E)).toBe(false);
  expect(hollow({...p, holds_before: true}, ONE)).toBe(false);
});

test('failing names each broken check in words', () => {
  const p = {expect: [{table: 'todos', row: '0', cell: 'text', eq: 'buy milk'}]} as Probe;
  expect(failing(p, E)).toEqual(['todos row 0: text should be "buy milk", but the row is missing']);
});

test('probeFromPlan reads one fence by clause', () => {
  const text = 'x\n```probe\n{"clause": "S1.1", "layer": "ui", "given": [], "do": [], "expect": [{"unchanged": true}]}\n```\n';
  expect(probeFromPlan(text, 'S1.1').layer).toBe('ui');
  expect(() => probeFromPlan(text, 'S9.9')).toThrow('no probe for clause S9.9');
});

test('aliases follow creation order, sorted within one read, across tables and cells', () => {
  const a = new Aliases();
  a.learn([{todos: {zz: {text: 'a'}}}, {}]);
  a.learn([{todos: {zz: {text: 'a'}, bb: {text: 'b'}, aa: {text: 'c'}}, tags: {q: {todoId: 'zz', name: 'x'}}}, {}]);
  expect(a.rename([{todos: {zz: {text: 'a'}, aa: {text: 'c'}}, tags: {q: {todoId: 'zz', name: 'x'}}}, {}]))
    .toEqual([{todos: {'0': {text: 'a'}, '2': {text: 'c'}}, tags: {'0': {todoId: '0', name: 'x'}}}, {}]);
  expect(a.rename([{todos: {new1: {text: 'n'}}}, {}])).toEqual([{todos: {'?new1': {text: 'n'}}}, {}]);
  const schema = {properties: {id: {type: 'string', 'x-row-of': 'todos'}, text: {type: 'string'}}};
  expect(a.args({id: '1', text: '1'}, schema)).toEqual({id: 'bb', text: '1'});
  expect(a.args({id: '7'}, schema)).toEqual({id: '7'});
});
