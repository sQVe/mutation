// The parts of a Babel node that the ignorer reads. Stryker passes a Babel NodePath but its types
// declare the path as empty.
interface BabelNode {
  type: string;
  name?: string;
  value?: BabelNode | string | boolean | number | null;
  callee?: BabelNode;
  key?: BabelNode;
  properties?: BabelNode[];
  test?: BabelNode;
  alternate?: BabelNode;
  expressions?: BabelNode[];
  arguments?: BabelNode[];
  object?: BabelNode;
  property?: BabelNode;
  computed?: boolean;
}

export interface BabelPath {
  node: BabelNode;
  parent: BabelNode;
  parentPath: BabelPath | null;
  key: string | number | null;
  listKey: string | null;
}

const literalTypes = new Set(['StringLiteral', 'NumericLiteral', 'BooleanLiteral', 'NullLiteral']);

const isAccess = (node: BabelNode): boolean => {
  if (node.type === 'Identifier' || node.type === 'ThisExpression') {
    return true;
  }

  const isMember = node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression';

  if (!isMember || node.object === undefined || node.property === undefined) {
    return false;
  }

  const hasSimpleProperty = node.computed === true ? isAccess(node.property) : true;

  return isAccess(node.object) && hasSimpleProperty;
};

const isSimpleArgument = (node: BabelNode) => isAccess(node) || literalTypes.has(node.type);

const isSimpleCall = (node: BabelNode) => {
  const isCall = node.type === 'CallExpression' || node.type === 'OptionalCallExpression';

  if (!isCall || node.callee === undefined || !isAccess(node.callee)) {
    return false;
  }

  return (node.arguments ?? []).every(isSimpleArgument);
};

const isSimpleExpression = (node: BabelNode) => isAccess(node) || isSimpleCall(node);

// The ignore API skips a node with all its descendants, so a template whose expressions hold logic
// keeps every mutant.
const isSkippableTemplate = (node: BabelNode) =>
  node.type === 'TemplateLiteral' && (node.expressions ?? []).every(isSimpleExpression);

const isTextNode = (node: BabelNode) => node.type === 'StringLiteral' || isSkippableTemplate(node);

const messageIndexOfBuiltinError = new Map([
  ['Error', 0],
  ['TypeError', 0],
  ['RangeError', 0],
  ['SyntaxError', 0],
  ['ReferenceError', 0],
  ['EvalError', 0],
  ['URIError', 0],
  ['AggregateError', 1],
]);

// A built-in error has a known message position. Another class ending in `Error` is skipped only
// when it takes a single argument, since a second argument may carry behavior.
const isErrorMessage = ({ parent, listKey, key }: BabelPath) => {
  const className = parent.callee?.type === 'Identifier' ? parent.callee.name : undefined;

  if (parent.type !== 'NewExpression' || listKey !== 'arguments' || className === undefined) {
    return false;
  }

  const builtinIndex = messageIndexOfBuiltinError.get(className);

  if (builtinIndex !== undefined) {
    return key === builtinIndex;
  }

  return className.endsWith('Error') && key === 0 && parent.arguments?.length === 1;
};

const isInvariantCall = (node: BabelNode) =>
  node.type === 'CallExpression' &&
  node.callee?.type === 'Identifier' &&
  node.callee.name === 'invariant';

const isInvariantMessage = ({ parent, listKey, key }: BabelPath) => {
  const isAfterFirstArgument = listKey === 'arguments' && typeof key === 'number' && key > 0;

  return isAfterFirstArgument && isInvariantCall(parent);
};

// The name of a property with a static key: an identifier or a string literal, never `[key]`.
const propertyName = (property: BabelNode) => {
  if (property.type !== 'ObjectProperty' || property.computed === true) {
    return undefined;
  }

  const { key } = property;

  if (key?.type === 'StringLiteral') {
    return typeof key.value === 'string' ? key.value : undefined;
  }

  return key?.type === 'Identifier' ? key.name : undefined;
};

// Stryker tests whether a mutant is active with a call to its `stryMutAct_` helper.
const isMutantSwitch = (node: BabelNode) =>
  node.type === 'ConditionalExpression' &&
  node.test?.type === 'CallExpression' &&
  node.test.callee?.name?.startsWith('stryMutAct_') === true;

// Stryker has already wrapped an expression that it mutated, as
// `mutantA ? mutated : mutantB ? mutated : (coverMutant(...), original)`. A conditional the
// project wrote is not a wrapper, so it is its own original.
const originalOf = (node: BabelNode): BabelNode => {
  if (isMutantSwitch(node) && node.alternate !== undefined) {
    return originalOf(node.alternate);
  }

  const original = node.type === 'SequenceExpression' ? node.expressions?.at(-1) : undefined;

  return original ?? node;
};

const isFalseLiteral = (node: BabelNode | undefined) =>
  node?.type === 'BooleanLiteral' && node.value === false;

const isOkFalse = (property: BabelNode) => {
  const { value } = property;

  if (propertyName(property) !== 'ok' || typeof value !== 'object' || value === null) {
    return false;
  }

  return isFalseLiteral(originalOf(value));
};

const isFailedResult = (object: BabelNode | undefined) =>
  object?.properties?.some(isOkFalse) === true;

const isFailedResultError = (path: BabelPath) => {
  const { parent } = path;

  if (
    parent.type !== 'ObjectProperty' ||
    path.key !== 'value' ||
    propertyName(parent) !== 'error'
  ) {
    return false;
  }

  return isFailedResult(path.parentPath?.parent);
};

const messagePropertyNames = new Set(['message', 'title', 'text', 'disabledReason']);

const isNamedPropertyValue = (path: BabelPath, names: ReadonlySet<string>) => {
  const { parent } = path;

  if (parent.type !== 'ObjectProperty' || path.key !== 'value') {
    return false;
  }

  const name = propertyName(parent);

  return name !== undefined && names.has(name);
};

const isMessageProperty = (path: BabelPath) => isNamedPropertyValue(path, messagePropertyNames);

const linesPropertyNames = new Set(['lines']);

const isLinesElement = ({ parent, listKey, parentPath }: BabelPath) => {
  const isArrayElement = parent.type === 'ArrayExpression' && listKey === 'elements';

  return (
    isArrayElement && parentPath !== null && isNamedPropertyValue(parentPath, linesPropertyNames)
  );
};

const messageCollectionNames = new Set<string | undefined>([
  'problems',
  'messages',
  'errors',
  'warnings',
  'issues',
  'failures',
]);

// A text node whose parent is a call is one of its arguments, since a string callee has no object.
// Only an identifier has a name, so `this.problems.push` keeps its mutants.
const isMessageCollectionArgument = ({ parent }: BabelPath) => {
  const { callee } = parent;
  const isPush = callee?.computed !== true && callee?.property?.name === 'push';
  const isCollection = messageCollectionNames.has(callee?.object?.name);

  return parent.type === 'CallExpression' && isPush && isCollection;
};

const reasonOfPosition = (path: BabelPath) => {
  if (isErrorMessage(path)) {
    return 'The text of an error message is not behavior.';
  }

  if (isInvariantMessage(path)) {
    return 'The text of an invariant message is not behavior.';
  }

  if (isFailedResultError(path)) {
    return 'The text of an error result is not behavior.';
  }

  if (isMessageProperty(path) || isLinesElement(path)) {
    return 'The text of a user-facing message is not behavior.';
  }

  if (isMessageCollectionArgument(path)) {
    return 'The text of a message pushed onto a list of messages is not behavior.';
  }

  return undefined;
};

const isBranchKey = (key: BabelPath['key']) => key === 'consequent' || key === 'alternate';

const isConditionalBranch = ({ parent, key }: BabelPath) =>
  parent.type === 'ConditionalExpression' && isBranchKey(key);

// A string branch of a conditional takes the position of the conditional. The walk skips only the
// literal, so the condition keeps its mutants.
const reasonOf = (path: BabelPath): string | undefined => {
  const reason = reasonOfPosition(path);

  if (reason !== undefined || path.parentPath === null) {
    return reason;
  }

  if (path.node.type !== 'StringLiteral' && path.node.type !== 'ConditionalExpression') {
    return undefined;
  }

  return isConditionalBranch(path) ? reasonOf(path.parentPath) : undefined;
};

export const ignorerName = 'tauMessageIgnorer';

export const enabledIgnorers = <Ignorer>(
  names: readonly string[] | undefined,
  ignorer: Ignorer,
): Ignorer[] => (names?.includes(ignorerName) === true ? [ignorer] : []);

// The cap count and the synthetic report instrument with the built-in ignorer only. Stryker has
// no small public way to load the ignorers a config names, so any other one is refused there.
export const unsupportedIgnorerError = (
  names: readonly string[] | undefined,
): string | undefined => {
  const unsupported = (names ?? []).filter((name) => name !== ignorerName);

  if (unsupported.length === 0) {
    return undefined;
  }

  const listed = unsupported.map((name) => `"${name}"`).join(', ');

  return `--max-mutants and --same-folder-tests support only the "${ignorerName}" ignorer, but the config names ${listed}.`;
};

export const ignoreReason = (path: BabelPath): string | undefined =>
  isTextNode(path.node) ? reasonOf(path) : undefined;
