/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { expect } from 'chai';
import { inspect } from 'util';

import {
  Binary,
  BSONTypeAlias,
  Document,
  Long,
  MongoError,
  MongoServerError,
  ObjectId,
  OneOrMore,
  ServerDescriptionChangedEvent
} from '../../../src';
import {
  CommandFailedEvent,
  CommandStartedEvent,
  CommandSucceededEvent,
  ConnectionCheckedInEvent,
  ConnectionCheckedOutEvent,
  ConnectionCheckOutFailedEvent,
  ConnectionCheckOutStartedEvent,
  ConnectionClosedEvent,
  ConnectionCreatedEvent,
  ConnectionPoolClearedEvent,
  ConnectionPoolClosedEvent,
  ConnectionPoolCreatedEvent,
  ConnectionPoolReadyEvent,
  ConnectionReadyEvent
} from '../../mongodb';
import { ejson } from '../utils';
import { CmapEvent, CommandEvent, EntitiesMap, SdamEvent } from './entities';
import {
  ExpectedCmapEvent,
  ExpectedCommandEvent,
  ExpectedError,
  ExpectedEventsForClient,
  ExpectedSdamEvent
} from './schema';

export interface ExistsOperator {
  $$exists: boolean;
}
export function isExistsOperator(value: unknown): value is ExistsOperator {
  return typeof value === 'object' && value != null && '$$exists' in value;
}
export interface TypeOperator {
  $$type: OneOrMore<BSONTypeAlias>;
}
export function isTypeOperator(value: unknown): value is TypeOperator {
  return typeof value === 'object' && value != null && '$$type' in value;
}
export interface MatchesEntityOperator {
  $$matchesEntity: string;
}
export function isMatchesEntityOperator(value: unknown): value is MatchesEntityOperator {
  return typeof value === 'object' && value != null && '$$matchesEntity' in value;
}
export interface MatchesHexBytesOperator {
  $$matchesHexBytes: string;
}
export function isMatchesHexBytesOperator(value: unknown): value is MatchesHexBytesOperator {
  return typeof value === 'object' && value != null && '$$matchesHexBytes' in value;
}
export interface UnsetOrMatchesOperator {
  $$unsetOrMatches: unknown;
}
export function isUnsetOrMatchesOperator(value: unknown): value is UnsetOrMatchesOperator {
  return typeof value === 'object' && value != null && '$$unsetOrMatches' in value;
}
export interface SessionLsidOperator {
  $$sessionLsid: string;
}
export function isSessionLsidOperator(value: unknown): value is SessionLsidOperator {
  return typeof value === 'object' && value != null && '$$sessionLsid' in value;
}

export const SpecialOperatorKeys = [
  '$$exists',
  '$$type',
  '$$matchesEntity',
  '$$matchesHexBytes',
  '$$unsetOrMatches',
  '$$sessionLsid'
];

export type SpecialOperator =
  | ExistsOperator
  | TypeOperator
  | MatchesEntityOperator
  | MatchesHexBytesOperator
  | UnsetOrMatchesOperator
  | SessionLsidOperator;

type KeysOfUnion<T> = T extends object ? keyof T : never;
export type SpecialOperatorKey = KeysOfUnion<SpecialOperator>;
export function isSpecialOperator(value: unknown): value is SpecialOperator {
  return (
    isExistsOperator(value) ||
    isTypeOperator(value) ||
    isMatchesEntityOperator(value) ||
    isMatchesHexBytesOperator(value) ||
    isUnsetOrMatchesOperator(value) ||
    isSessionLsidOperator(value)
  );
}

const TYPE_MAP = new Map();

TYPE_MAP.set('double', actual => typeof actual === 'number' || actual._bsontype === 'Double');
TYPE_MAP.set('string', actual => typeof actual === 'string');
TYPE_MAP.set('object', actual => typeof actual === 'object' && actual !== null);
TYPE_MAP.set('array', actual => Array.isArray(actual));
TYPE_MAP.set('binData', actual => actual instanceof Binary);
TYPE_MAP.set('undefined', actual => actual === undefined);
TYPE_MAP.set('objectId', actual => actual instanceof ObjectId);
TYPE_MAP.set('bool', actual => typeof actual === 'boolean');
TYPE_MAP.set('date', actual => actual instanceof Date);
TYPE_MAP.set('null', actual => actual === null);
TYPE_MAP.set('regex', actual => actual instanceof RegExp || actual._bsontype === 'BSONRegExp');
TYPE_MAP.set('dbPointer', actual => actual._bsontype === 'DBRef');
TYPE_MAP.set('javascript', actual => actual._bsontype === 'Code');
TYPE_MAP.set('symbol', actual => actual._bsontype === 'Symbol');
TYPE_MAP.set('javascriptWithScope', actual => actual._bsontype === 'Code' && actual.scope);
TYPE_MAP.set('timestamp', actual => actual._bsontype === 'Timestamp');
TYPE_MAP.set('decimal', actual => actual._bsontype === 'Decimal128');
TYPE_MAP.set('minKey', actual => actual._bsontype === 'MinKey');
TYPE_MAP.set('maxKey', actual => actual._bsontype === 'MaxKey');
TYPE_MAP.set(
  'int',
  actual => (typeof actual === 'number' && Number.isInteger(actual)) || actual._bsontype === 'Int32'
);
TYPE_MAP.set(
  'long',
  actual => (typeof actual === 'number' && Number.isInteger(actual)) || Long.isLong(actual)
);

/**
 * resultCheck
 *
 * @param actual - the actual result
 * @param expected - the expected result
 * @param entities - the EntitiesMap associated with the test
 * @param path - an array of strings representing the 'path' in the document down to the current
 *              value.  For example, given `{ a: { b: { c: 4 } } }`, when evaluating `{ c: 4 }`, the path
 *              will look like: `['a', 'b']`.  Used to print useful error messages when assertions fail.
 * @param checkExtraKeys - a boolean value that determines how keys present on the `actual` object but
 *              not on the `expected` object are treated.  When set to `true`, any extra keys on the
 *              `actual` object will throw an error
 */
export function resultCheck(
  actual: Document,
  expected: Document | number | string | boolean,
  entities: EntitiesMap,
  path: string[] = [],
  checkExtraKeys = false
): void {
  function checkNestedDocuments(key: string, value: any, checkExtraKeys: boolean) {
    if (key === 'sort') {
      // TODO: This is a workaround that works because all sorts in the specs
      // are objects with one key; ideally we'd want to adjust the spec definitions
      // to indicate whether order matters for any given key and set general
      // expectations accordingly (see NODE-3235)
      expect(Object.keys(value)).to.have.lengthOf(1);
      expect(actual[key]).to.be.instanceOf(Map);
      expect(actual[key].size).to.equal(1);
      const expectedSortKey = Object.keys(value)[0];
      expect(actual[key]).to.have.all.keys(expectedSortKey);
      const objFromActual = { [expectedSortKey]: actual[key].get(expectedSortKey) };
      resultCheck(objFromActual, value, entities, path, checkExtraKeys);
    } else if (key === 'createIndexes') {
      for (const [i, userIndex] of actual.indexes.entries()) {
        expect(expected).to.have.nested.property(`.indexes[${i}].key`).to.be.a('object');
        // @ts-expect-error: Not worth narrowing to a document
        expect(Object.keys(expected.indexes[i].key)).to.have.lengthOf(1);
        expect(userIndex).to.have.property('key').that.is.instanceOf(Map);
        expect(
          userIndex.key.size,
          'Test input is JSON and cannot correctly test more than 1 key'
        ).to.equal(1);
        userIndex.key = Object.fromEntries(userIndex.key);
      }
      resultCheck(actual[key], value, entities, path, checkExtraKeys);
    } else {
      resultCheck(actual[key], value, entities, path, checkExtraKeys);
    }
  }

  if (typeof expected === 'object' && expected) {
    // Expected is an object
    // either its a special operator or just an object to check equality against

    if (isSpecialOperator(expected)) {
      // Special operation check is a base condition
      // specialCheck may recurse depending upon the check ($$unsetOrMatches)
      specialCheck(actual, expected, entities, path, checkExtraKeys);
      return;
    }

    const expectedEntries = Object.entries(expected);

    if (Array.isArray(expected)) {
      if (!Array.isArray(actual)) {
        expect.fail(
          `expected value at ${path.join('.')} to be an array, but received ${inspect(actual)}`
        );
      }
      for (const [index, value] of expectedEntries) {
        path.push(`[${index}]`);
        checkNestedDocuments(index, value, false);
        path.pop();
      }
    } else {
      for (const [key, value] of expectedEntries) {
        path.push(`.${key}`);
        checkNestedDocuments(key, value, true);
        path.pop();
      }

      if (checkExtraKeys) {
        expect(actual, `Expected actual to exist at ${path.join('')}`).to.exist;
        // by using `Object.keys`, we ignore non-enumerable properties. This is intentional.
        const actualKeys = Object.keys(actual);
        const expectedKeys = Object.keys(expected);
        // Don't check for full key set equality because some of the actual keys
        // might be e.g. $$unsetOrMatches, which can be omitted.
        const extraKeys = actualKeys.filter(key => !expectedKeys.includes(key));

        if (extraKeys.length > 0) {
          expect.fail(
            `object has more keys than expected.  \n\tactual: [${actualKeys}] \n\texpected: [${expectedKeys}]`
          );
        }
      }
    }

    return;
  }

  // Here's our recursion base case
  // expected is: number | Long | string | boolean | null
  if (Long.isLong(actual) && typeof expected === 'number') {
    // Long requires special equality check
    expect(actual.equals(expected)).to.be.true;
  } else if (Long.isLong(expected) && typeof actual === 'number') {
    // Long requires special equality check
    expect(expected.equals(actual)).to.be.true;
  } else if (Number.isNaN(actual) && Number.isNaN(expected)) {
    // in JS, NaN isn't equal to NaN but we want to not fail if we have two NaN
  } else if (
    typeof expected === 'number' &&
    typeof actual === 'number' &&
    expected === 0 &&
    actual === 0
  ) {
    // case to handle +0 and -0
    expect(Object.is(expected, actual)).to.be.true;
  } else {
    expect(actual).to.equal(expected);
  }
}

export function specialCheck(
  actual: Document,
  expected: SpecialOperator,
  entities: EntitiesMap,
  path: string[] = [],
  checkExtraKeys: boolean
): void {
  if (isUnsetOrMatchesOperator(expected)) {
    if (actual === null || actual === undefined) return;

    resultCheck(actual, expected.$$unsetOrMatches as any, entities, path, checkExtraKeys);
  } else if (isMatchesEntityOperator(expected)) {
    // $$matchesEntity
    const entity = entities.get(expected.$$matchesEntity);
    if (
      typeof actual === 'object' && // an object
      actual && // that isn't null
      'equals' in actual && // with an equals
      typeof actual.equals === 'function' // method
    ) {
      expect(actual.equals(entity)).to.be.true;
    } else {
      expect(actual).to.equal(entity);
    }
  } else if (isMatchesHexBytesOperator(expected)) {
    // $$matchesHexBytes
    const expectedBuffer = Buffer.from(expected.$$matchesHexBytes, 'hex');
    expect(expectedBuffer.every((byte, index) => byte === actual[index])).to.be.true;
  } else if (isSessionLsidOperator(expected)) {
    // $$sessionLsid
    const session = entities.getEntity('session', expected.$$sessionLsid, false);
    expect(session, `Session ${expected.$$sessionLsid} does not exist in entities`).to.exist;
    const entitySessionHex = session.id!.id.buffer.toString('hex').toUpperCase();
    const actualSessionHex = actual.id.buffer.toString('hex').toUpperCase();
    expect(
      entitySessionHex,
      `Session entity ${expected.$$sessionLsid} does not match lsid`
    ).to.equal(actualSessionHex);
  } else if (isTypeOperator(expected)) {
    // $$type
    let ok = false;
    const types = Array.isArray(expected.$$type) ? expected.$$type : [expected.$$type];
    for (const type of types) {
      ok ||= TYPE_MAP.get(type)(actual);
    }
    expect(ok, `Expected [${actual}] to be one of [${types}]`).to.be.true;
  } else if (isExistsOperator(expected)) {
    // $$exists
    const actualExists = actual !== undefined && actual !== null;

    if (expected.$$exists) {
      expect(
        actualExists,
        ejson`expected value at path ${path.join('')} to exist, but received ${actual}`
      ).to.be.true;
    } else {
      expect(
        actualExists,
        ejson`expected value at path ${path.join('')} NOT to exist, but received ${actual}`
      ).to.be.false;
    }
  } else {
    expect.fail(`Unknown special operator: ${JSON.stringify(expected)}`);
  }
}

// CMAP events where the payload does not matter.
const EMPTY_CMAP_EVENTS = {
  poolCreatedEvent: ConnectionPoolCreatedEvent,
  poolReadyEvent: ConnectionPoolReadyEvent,
  poolClosedEvent: ConnectionPoolClosedEvent,
  connectionCreatedEvent: ConnectionCreatedEvent,
  connectionReadyEvent: ConnectionReadyEvent,
  connectionCheckOutStartedEvent: ConnectionCheckOutStartedEvent,
  connectionCheckOutFailedEvent: ConnectionCheckOutFailedEvent,
  connectionCheckedOutEvent: ConnectionCheckedOutEvent,
  connectionCheckedInEvent: ConnectionCheckedInEvent
};

function validEmptyCmapEvent(expected: ExpectedCommandEvent | ExpectedCmapEvent) {
  const expectedEventName = Object.keys(expected)[0];
  return !!EMPTY_CMAP_EVENTS[expectedEventName];
}

function failOnMismatchedCount(
  actual: CommandEvent[] | CmapEvent[] | SdamEvent[],
  expected: (ExpectedCommandEvent & ExpectedCmapEvent & ExpectedSdamEvent)[]
) {
  const actualNames = actual.map(a => a.constructor.name);
  const expectedNames = expected.map(e => Object.keys(e)[0]);
  expect.fail(
    `Expected event count mismatch, expected ${inspect(expectedNames)} but got ${inspect(
      actualNames
    )}`
  );
}

function compareCommandStartedEvents(
  actual: CommandStartedEvent,
  expected: ExpectedCommandEvent['commandStartedEvent'],
  entities: EntitiesMap,
  prefix: string
) {
  if (expected!.command) {
    resultCheck(actual.command, expected!.command, entities, [`${prefix}.command`]);
  }
  if (expected!.commandName) {
    expect(
      expected!.commandName,
      `expected ${prefix}.commandName to equal ${expected!.commandName} but received ${
        actual.commandName
      }`
    ).to.equal(actual.commandName);
  }
  if (expected!.databaseName) {
    expect(
      expected!.databaseName,
      `expected ${prefix}.databaseName to equal ${expected!.databaseName} but received ${
        actual.databaseName
      }`
    ).to.equal(actual.databaseName);
  }
}

function compareCommandSucceededEvents(
  actual: CommandSucceededEvent,
  expected: ExpectedCommandEvent['commandSucceededEvent'],
  entities: EntitiesMap,
  prefix: string
) {
  if (expected!.reply) {
    resultCheck(actual.reply as Document, expected!.reply, entities, [prefix]);
  }
  if (expected!.commandName) {
    expect(
      expected!.commandName,
      `expected ${prefix}.commandName to equal ${expected!.commandName} but received ${
        actual.commandName
      }`
    ).to.equal(actual.commandName);
  }
}

function compareCommandFailedEvents(
  actual: CommandFailedEvent,
  expected: ExpectedCommandEvent['commandFailedEvent'],
  entities: EntitiesMap,
  prefix: string
) {
  if (expected!.commandName) {
    expect(
      expected!.commandName,
      `expected ${prefix}.commandName to equal ${expected!.commandName} but received ${
        actual.commandName
      }`
    ).to.equal(actual.commandName);
  }
}

function compareEvents(
  actual: CommandEvent[] | CmapEvent[] | SdamEvent[],
  expected: (ExpectedCommandEvent & ExpectedCmapEvent & ExpectedSdamEvent)[],
  entities: EntitiesMap
) {
  if (actual.length !== expected.length) {
    failOnMismatchedCount(actual, expected);
  }
  for (const [index, actualEvent] of actual.entries()) {
    const expectedEvent = expected[index];
    const rootPrefix = `events[${index}]`;

    if (expectedEvent.commandStartedEvent) {
      const path = `${rootPrefix}.commandStartedEvent`;
      if (!(actualEvent instanceof CommandStartedEvent)) {
        expect.fail(`expected ${path} to be instanceof CommandStartedEvent`);
      }
      compareCommandStartedEvents(actualEvent, expectedEvent.commandStartedEvent, entities, path);
    } else if (expectedEvent.commandSucceededEvent) {
      const path = `${rootPrefix}.commandSucceededEvent`;
      if (!(actualEvent instanceof CommandSucceededEvent)) {
        expect.fail(`expected ${path} to be instanceof CommandSucceededEvent`);
      }
      compareCommandSucceededEvents(
        actualEvent,
        expectedEvent.commandSucceededEvent,
        entities,
        path
      );
    } else if (expectedEvent.commandFailedEvent) {
      const path = `${rootPrefix}.commandFailedEvent`;
      if (!(actualEvent instanceof CommandFailedEvent)) {
        expect.fail(`expected ${path} to be instanceof CommandFailedEvent`);
      }
      compareCommandFailedEvents(actualEvent, expectedEvent.commandFailedEvent, entities, path);
    } else if (expectedEvent.connectionClosedEvent) {
      expect(actualEvent).to.be.instanceOf(ConnectionClosedEvent);
      if (expectedEvent.connectionClosedEvent.hasServiceId) {
        expect(actualEvent).property('serviceId').to.exist;
      }
    } else if (expectedEvent.poolClearedEvent) {
      expect(actualEvent).to.be.instanceOf(ConnectionPoolClearedEvent);
      if (expectedEvent.poolClearedEvent.hasServiceId) {
        expect(actualEvent).property('serviceId').to.exist;
      }
      if (expectedEvent.poolClearedEvent.interruptInUseConnections != null) {
        expect(actualEvent)
          .property('interruptInUseConnections')
          .to.equal(expectedEvent.poolClearedEvent.interruptInUseConnections);
      }
    } else if (validEmptyCmapEvent(expectedEvent as ExpectedCmapEvent)) {
      const expectedEventName = Object.keys(expectedEvent)[0];
      const expectedEventInstance = EMPTY_CMAP_EVENTS[expectedEventName];
      expect(actualEvent).to.be.instanceOf(expectedEventInstance);
    } else if (expectedEvent.serverDescriptionChangedEvent) {
      expect(actualEvent).to.be.instanceOf(ServerDescriptionChangedEvent);
      const expectedServerDescriptionKeys = ['previousDescription', 'newDescription'];
      expect(expectedServerDescriptionKeys).to.include.all.members(
        Object.keys(expectedEvent.serverDescriptionChangedEvent)
      );
      for (const descriptionKey of expectedServerDescriptionKeys) {
        expect(actualEvent).to.have.property(descriptionKey);
        const expectedDescription =
          expectedEvent.serverDescriptionChangedEvent[descriptionKey] ?? {};
        for (const nestedKey of Object.keys(expectedDescription)) {
          expect(actualEvent[descriptionKey]).to.have.property(
            nestedKey,
            expectedDescription[nestedKey]
          );
        }
      }
      return;
    } else {
      expect.fail(`Encountered unexpected event - ${inspect(actualEvent)}`);
    }
  }
}

export function matchesEvents(
  { events: expected, ignoreExtraEvents }: ExpectedEventsForClient,
  actual: CommandEvent[] | CmapEvent[] | SdamEvent[],
  entities: EntitiesMap
): void {
  ignoreExtraEvents = ignoreExtraEvents ?? false;

  if (ignoreExtraEvents) {
    if (actual.length < expected.length) {
      failOnMismatchedCount(actual, expected);
    }

    const slicedActualEvents = actual.slice(0, expected.length);

    compareEvents(slicedActualEvents, expected, entities);
  } else {
    if (actual.length !== expected.length) {
      failOnMismatchedCount(actual, expected);
    }

    compareEvents(actual, expected, entities);
  }
}

function isMongoCryptError(err): boolean {
  if (err.constructor.name === 'MongoCryptError') {
    return true;
  }
  return err.stack.includes('at ClientEncryption');
}

export function expectErrorCheck(
  error: Error | MongoError,
  expected: ExpectedError,
  entities: EntitiesMap
): void {
  const expectMessage = `\n\nOriginal Error Stack:\n${error.stack}\n\n`;

  if (!isMongoCryptError(error)) {
    expect(error, expectMessage).to.be.instanceOf(MongoError);
  }

  if (expected.isClientError === false) {
    expect(error).to.be.instanceOf(MongoServerError);
  } else if (expected.isClientError === true) {
    expect(error).not.to.be.instanceOf(MongoServerError);
  }

  if (expected.errorContains != null) {
    expect(error.message, expectMessage).to.include(expected.errorContains);
  }

  if (expected.errorCode != null) {
    expect(error, expectMessage).to.have.property('code', expected.errorCode);
  }

  if (expected.errorCodeName != null) {
    expect(error, expectMessage).to.have.property('codeName', expected.errorCodeName);
  }

  if (expected.errorLabelsContain != null) {
    const mongoError = error as MongoError;
    for (const errorLabel of expected.errorLabelsContain) {
      expect(
        mongoError.hasErrorLabel(errorLabel),
        `Error was supposed to have label ${errorLabel}, has [${mongoError.errorLabels}] -- ${expectMessage}`
      ).to.be.true;
    }
  }

  if (expected.errorLabelsOmit != null) {
    const mongoError = error as MongoError;
    for (const errorLabel of expected.errorLabelsOmit) {
      expect(
        mongoError.hasErrorLabel(errorLabel),
        `Error was not supposed to have label ${errorLabel}, has [${mongoError.errorLabels}] -- ${expectMessage}`
      ).to.be.false;
    }
  }

  if (expected.expectResult != null) {
    resultCheck(error, expected.expectResult as any, entities);
  }
}
