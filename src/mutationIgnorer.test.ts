/* oxlint-disable no-template-curly-in-string -- the fixtures are source text. */
import { Instrumenter } from '@stryker-mutator/instrumenter';
import { noopLogger } from '@stryker-mutator/util';
import { describe, expect, it } from 'vitest';

import { mutationIgnorer } from './mutationIgnorer.ts';

const instrument = async (content: string) => {
  const result = await new Instrumenter(noopLogger).instrument(
    [{ name: 'fixture.ts', content, mutate: true }],
    { plugins: null, excludedMutations: [], ignorers: [mutationIgnorer] },
  );

  return result.mutants;
};

const stringMutants = async (content: string) => {
  const mutants = await instrument(content);

  return mutants.filter(({ mutatorName }) => mutatorName === 'StringLiteral');
};

describe('mutationIgnorer', () => {
  it.each([
    { name: 'an Error message', source: "throw new Error('x');" },
    { name: 'a custom error message', source: "throw new ParseError('x');" },
    { name: 'an AggregateError message', source: "new AggregateError(errors, 'x');" },
    { name: 'an invariant message', source: "invariant(cond, 'x');" },
    { name: 'an invariant template message', source: 'invariant(cond, `x`);' },
    { name: 'the error of a failed result', source: "const value = { ok: false, error: 'x' };" },
  ])('skips $name', async ({ source }) => {
    const mutants = await stringMutants(source);

    expect(mutants.length).toBeGreaterThan(0);
    expect(mutants.every(({ status }) => status === 'Ignored')).toBe(true);
  });

  it('keeps the mutants inside the expression of a template message', async () => {
    const source = `throw new Error(\`bad \${flag ? 'a' : 'b'}\`);`;
    const mutants = await instrument(source);

    expect(mutants.length).toBeGreaterThan(0);
    expect(mutants.every(({ status }) => status !== 'Ignored')).toBe(true);
  });

  it.each([
    { name: 'a message property', source: "const a = { message: 'x' };" },
    { name: 'a title property', source: "const a = { title: 'x' };" },
    { name: 'a text property', source: "const a = { text: 'x' };" },
    { name: 'a disabledReason property', source: "const a = { disabledReason: 'x' };" },
    { name: 'a lines element', source: "const a = { lines: ['x', 'y'] };" },
    { name: 'a template message with identifiers', source: 'const a = { message: `x ${name}` };' },
    { name: 'a template message with members', source: 'const a = { text: `x ${a.b.c}` };' },
    {
      name: 'a template message with simple calls',
      source: 'const a = { title: `x ${f(a, b.c, 1)}` };',
    },
    { name: 'a lines template', source: 'const a = { lines: [`x ${name}`] };' },
    { name: 'a branch of a message', source: "const a = { message: ready ? 'a' : 'b' };" },
    {
      name: 'a nested branch of a message',
      source: "const a = { message: p ? 'a' : q ? 'b' : 'c' };",
    },
    { name: 'a branch of an error message', source: "throw new Error(p ? 'a' : 'b');" },
  ])('skips every string mutant of $name', async ({ source }) => {
    const mutants = await stringMutants(source);

    expect(mutants.length).toBeGreaterThan(0);
    expect(mutants.every(({ status }) => status === 'Ignored')).toBe(true);
  });

  it('skips both strings of a disabledReason ternary and keeps the conditional mutants', async () => {
    const mutants = await instrument(
      "const a = { disabledReason: ready ? 'Ready' : 'Not ready' };",
    );

    const strings = mutants.filter(({ mutatorName }) => mutatorName === 'StringLiteral');
    const rest = mutants.filter(({ mutatorName }) => mutatorName !== 'StringLiteral');

    expect(strings).toHaveLength(2);
    expect(strings.every(({ status }) => status === 'Ignored')).toBe(true);
    expect(rest.length).toBeGreaterThan(0);
    expect(rest.every(({ status }) => status !== 'Ignored')).toBe(true);
  });

  it.each([
    { name: 'a conditional', source: 'const a = { message: `x ${p ? 1 : 2}` };' },
    { name: 'a comparison', source: 'const a = { message: `x ${a === b ? x : y}` };' },
    { name: 'a logical expression', source: 'const a = { text: `x ${a || b}` };' },
    { name: 'a binary expression', source: 'const a = { title: `x ${a + b}` };' },
    { name: 'a unary expression', source: 'const a = { title: `x ${!a}` };' },
    { name: 'an update expression', source: 'const a = { title: `x ${i++}` };' },
    { name: 'a call with a call argument', source: 'const a = { title: `x ${f(g(a))}` };' },
    { name: 'a lines template with logic', source: 'const a = { lines: [`x ${a ? b : c}`] };' },
  ])('keeps every mutant of a template message with $name', async ({ source }) => {
    const mutants = await instrument(source);

    expect(mutants.length).toBeGreaterThan(0);
    expect(mutants.every(({ status }) => status !== 'Ignored')).toBe(true);
  });

  it('keeps the equality and string mutants next to a message', async () => {
    const source = "const a = { message: 'x', hidden: snapshot.searchText === '' };";
    const mutants = await instrument(source);
    const equality = mutants.filter(({ mutatorName }) => mutatorName === 'EqualityOperator');
    const strings = mutants.filter(({ mutatorName }) => mutatorName === 'StringLiteral');
    const kept = strings.filter(({ status }) => status !== 'Ignored');

    expect(equality.length).toBeGreaterThan(0);
    expect(equality.every(({ status }) => status !== 'Ignored')).toBe(true);
    expect(strings).toHaveLength(2);
    expect(kept).toHaveLength(1);
  });

  it.each([
    { name: 'a lines value that is not an array', source: "const a = { lines: 'x' };" },
    { name: 'an array under another name', source: "const a = { rows: ['x'] };" },
    { name: 'a nested array in lines', source: "const a = { lines: [['x']] };" },
    { name: 'a conditional outside a message', source: "const a = { other: p ? 'a' : 'b' };" },
    { name: 'a computed key named message', source: "const a = { [message]: 'x' };" },
  ])('keeps a string mutant in $name', async ({ source }) => {
    const mutants = await stringMutants(source);

    expect(mutants.some(({ status }) => status !== 'Ignored')).toBe(true);
  });

  it.each([
    { name: 'a plain object value', source: "const value = { label: 'x' };" },
    { name: 'the error of a passing result', source: "const value = { ok: true, error: 'x' };" },
    { name: 'the condition of an invariant', source: "invariant('x', 'y');" },
    { name: 'a call argument', source: "report('x');" },
    { name: 'a custom error with a second string', source: "new TaskFormatError('retired', 'x');" },
    { name: 'an AggregateError errors list', source: "new AggregateError('x');" },
    { name: 'a class that is not an error', source: "new Thing('x');" },
  ])('keeps a string mutant in $name', async ({ source }) => {
    const mutants = await stringMutants(source);

    expect(mutants.some(({ status }) => status !== 'Ignored')).toBe(true);
  });

  it('keeps both strings of a custom error with two arguments', async () => {
    const mutants = await stringMutants("new TaskFormatError('retired', 'x');");

    expect(mutants).toHaveLength(2);
    expect(mutants.every(({ status }) => status !== 'Ignored')).toBe(true);
  });
});
