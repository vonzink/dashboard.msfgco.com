'use strict';
// Deliberately small: only supports the schema vocabulary used by this package.
// Unsupported constructs fail instead of silently weakening exported types.
const annotations = ['title', 'description', '$comment', 'default', 'examples'];
function unsupported(condition, detail) {
  if (!condition) throw new Error(`Unsupported schema type generation: ${detail}`);
}
function keys(schema, allowed) {
  unsupported(schema && typeof schema === 'object' && !Array.isArray(schema), 'schema object');
  const accepted = new Set([...allowed, ...annotations]);
  for (const key of Object.keys(schema)) unsupported(accepted.has(key), `keyword ${key}`);
}
function typeOf(schema) {
  if (schema.$ref) {
    keys(schema, ['$ref']);
    unsupported(/^#\/definitions\/[A-Za-z_$][A-Za-z0-9_$]*$/.test(schema.$ref), 'reference');
    return schema.$ref.split('/').at(-1);
  }
  if ('const' in schema) {
    keys(schema, ['const']);
    unsupported(schema.const === null || ['string', 'number', 'boolean'].includes(typeof schema.const), 'non-scalar const');
    return JSON.stringify(schema.const);
  }
  if (schema.enum) {
    keys(schema, ['enum', 'type']);
    unsupported(['string', 'number', 'integer', 'boolean'].includes(schema.type), 'enum type');
    unsupported(Array.isArray(schema.enum) && schema.enum.length > 0 && schema.enum.every(value => schema.type === 'integer' ? Number.isInteger(value) : typeof value === schema.type), 'enum values');
    return schema.enum.map(value => JSON.stringify(value)).join(' | ');
  }
  if (schema.oneOf) {
    keys(schema, ['oneOf']);
    unsupported(Array.isArray(schema.oneOf) && schema.oneOf.length > 0, 'oneOf');
    return schema.oneOf.map(typeOf).map(x => `(${x})`).join(' | ');
  }
  if (schema.type === 'array') {
    keys(schema, ['type', 'items', 'minItems', 'maxItems', 'uniqueItems']);
    unsupported(schema.items && !Array.isArray(schema.items), 'tuple or missing items');
    return `Array<${typeOf(schema.items)}>`;
  }
  if (schema.type === 'object') {
    keys(schema, ['type', 'properties', 'required', 'additionalProperties', 'patternProperties', 'maxProperties', 'minProperties']);
    unsupported(schema.additionalProperties === false, 'open object');
    if (schema.patternProperties) {
      unsupported(!schema.properties && (!schema.required || schema.required.length === 0) && Object.keys(schema.patternProperties).length === 1, 'mixed or multiple property patterns');
      return `Record<string, ${typeOf(Object.values(schema.patternProperties)[0])}>`;
    }
    unsupported(schema.properties && Array.isArray(schema.required) && schema.required.every(key => Object.hasOwn(schema.properties, key)), 'object properties/required');
    return '{\n' + Object.entries(schema.properties).map(([key, value]) => `  ${JSON.stringify(key)}${schema.required.includes(key) ? '' : '?'}: ${typeOf(value)};`).join('\n') + '\n}';
  }
  if (schema.type === 'integer' || schema.type === 'number') {
    keys(schema, ['type', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf']);
    return 'number';
  }
  if (schema.type === 'string') {
    keys(schema, ['type', 'minLength', 'maxLength', 'pattern', 'format']);
    return 'string';
  }
  if (schema.type === 'boolean') { keys(schema, ['type']); return 'boolean'; }
  throw new Error('Unsupported schema type generation');
}
function generateTypes(schema) {
  keys(schema, ['$schema', '$id', '$ref', 'definitions']);
  unsupported(schema.definitions && typeof schema.definitions === 'object', 'definitions');
  for (const name of Object.keys(schema.definitions)) unsupported(/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name), 'definition name');
  return '// Generated from site.schema.json by typegen.cjs; checked by check-contracts.mjs.\n'
    + Object.entries(schema.definitions).map(([name, value]) => `export type ${name} = ${typeOf(value)};\n`).join('\n')
    + '\nexport declare class ContractValidationError extends Error { readonly code: "invalid_public_contract"; }\n'
    + ['SiteSnapshot', 'OfficerRevocations', 'PublishRequest', 'ActivePointer', 'PublicationResult', 'PageSeo'].map(name => `export declare function parse${name === 'OfficerRevocations' ? 'Revocations' : name}(value: unknown): ${name};`).join('\n') + '\n';
}
module.exports = { generateTypes };
