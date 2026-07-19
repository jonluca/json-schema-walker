import assert from "node:assert/strict";
import { test } from "node:test";
import walkerPackage from "../dist/index.js";

const { Walker } = walkerPackage;

test("visits each standard subschema once and skips dependency name arrays", () => {
  const walker = new Walker();
  walker.loadSchemaSync({
    allOf: [{ title: "allOf-a" }, { title: "allOf-b" }],
    propertyNames: { title: "propertyNames" },
    contains: { title: "contains" },
    definitions: { Defined: { title: "definition" } },
    dependencies: {
      names: ["first", "last"],
      schema: { title: "dependency-schema" },
    },
  });

  const visited = [];
  walker.walkSync((schema) => visited.push(schema), walker.vocabularies.DRAFT_07);

  assert.deepEqual(
    visited.flatMap((schema) => (schema.title ? [schema.title] : [])).sort(),
    ["allOf-a", "allOf-b", "contains", "definition", "dependency-schema", "propertyNames"].sort(),
  );
  assert.equal(visited.some(Array.isArray), false);
});

test("dereferencing clones input and honors Draft-07 root-reference semantics", async () => {
  const input = {
    $ref: "#/definitions/Thing",
    title: "ignored root sibling",
    definitions: {
      Thing: {
        title: "referenced definition",
        type: "object",
        properties: { self: { $ref: "#/definitions/Thing" } },
      },
    },
  };
  const original = structuredClone(input);
  const walker = new Walker();

  await walker.loadSchema(input, { cloneSchema: true, dereference: true });

  assert.deepEqual(input, original);
  assert.equal(walker.rootSchema.title, "referenced definition");

  let visits = 0;
  await walker.walk(() => {
    visits += 1;
  }, walker.vocabularies.DRAFT_07);
  assert.ok(visits > 0 && visits < 10);
});

test("terminates on caller-provided circular schemas", () => {
  const schema = { type: "object", properties: {} };
  schema.properties.self = schema;
  const walker = new Walker();
  walker.loadSchemaSync(schema, { cloneSchema: false });

  let visits = 0;
  walker.walkSync(() => {
    visits += 1;
  }, walker.vocabularies.DRAFT_07);

  assert.equal(visits, 1);
});
