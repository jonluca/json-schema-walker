# JSON Schema Walker

Loosely based on [CloudFlare's json schema tools](https://github.com/cloudflare/json-schema-tools/tree/master/workspaces/json-schema-walker)

A system that visits all schema objects in a JSON Schema document and makes callbacks before and/or after visiting all of the current schema object's subschemas.

## Usage

```typescript
import { Walker } from "json-schema-walker";
const schema = {
  // your json schema
};
const walker = new Walker<T>();
await walker.loadSchema(schema, {
  cloneSchema: true,
  dereference: false,
  dereferenceOptions: {
    dereference: {
      circular: "ignore",
    },
  },
});
const convertSchema = (schema) => {
  // do something with the schema properties
};
await walker.walk(convertSchema, walker.vocabularies.DRAFT_07);
const updatedSchema = walker.rootSchema;
```

## Circular references

Passing the options

```json
{
  "dereferenceOptions": {
    "dereference": {
      "circular": "ignore"
    }
  }
}
```

will dereference all non-circular references in your schema.

## Synchronous API

For cases where you don't need `$ref` resolution, you can use the synchronous methods:

```typescript
import { Walker } from "json-schema-walker";
const schema = {
  // your json schema (without $ref)
};
const walker = new Walker<T>();
walker.loadSchemaSync(schema, {
  cloneSchema: true, // only option available
});
const convertSchema = (schema) => {
  // do something with the schema properties
};
walker.walkSync(convertSchema, walker.vocabularies.DRAFT_07);
const updatedSchema = walker.rootSchema;
```

> ⚠️ **Warning**: The synchronous methods (`loadSchemaSync` and `walkSync`) do not support `$ref` resolution. Use the async methods if your schema contains references.
