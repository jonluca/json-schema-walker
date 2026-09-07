const assert = require("node:assert/strict");
const { Walker } = require("../dist/index.js");

const collectNodes = async (schema, mode, vocabularyName = "DRAFT_07", options) => {
  const walker = new Walker();
  const visited = [];
  if (mode === "sync") {
    walker.loadSchemaSync(schema, options);
    walker.walkSync((node) => visited.push(node), walker.vocabularies[vocabularyName]);
  } else {
    await walker.loadSchema(schema, options);
    await walker.walk((node) => visited.push(node), walker.vocabularies[vocabularyName]);
  }
  return visited;
};

const collectTitlesSync = (schema) => {
  const walker = new Walker();
  walker.loadSchemaSync(schema);
  const titles = [];
  const visited = [];
  walker.walkSync((node) => {
    visited.push(node);
    if (node.title) titles.push(node.title);
  }, walker.vocabularies.DRAFT_07);
  return { titles, visited };
};

async function main() {
  for (const mode of ["sync", "async"]) {
    const booleanSchemas = {
      properties: { allowed: true, forbidden: false },
      patternProperties: { "^a": false },
      definitions: { allowed: true },
      additionalProperties: false,
      dependencies: { allowed: true, forbidden: false, names: ["other"] },
      items: false,
      additionalItems: true,
      allOf: [true, false],
      anyOf: [false, true],
      oneOf: [true, false],
      not: false,
      if: true,
      then: false,
      else: true,
      propertyNames: false,
      contains: true,
      enum: [true, false],
      default: { properties: { ignored: {} } },
    };
    const visitedBooleans = await collectNodes(booleanSchemas, mode);
    assert.deepEqual(
      visitedBooleans.slice(1),
      [
        true,
        false,
        false,
        true,
        false,
        true,
        false,
        false,
        true,
        true,
        false,
        false,
        true,
        true,
        false,
        false,
        true,
        false,
        true,
        false,
        true,
      ],
      `${mode}: all boolean subschemas are visited, without visiting instance data`,
    );
    assert.deepEqual((await collectNodes({ items: [true, false] }, mode)).slice(1), [true, false]);

    for (const value of [true, false]) {
      assert.deepEqual(await collectNodes(value, mode), [value]);
      assert.deepEqual(await collectNodes(value, mode, "DRAFT_07", { dereference: true }), [value]);
    }

    for (const [vocabulary, keys] of [
      ["DRAFT_04_HYPER", ["schema", "targetSchema"]],
      ["DRAFT_06_HYPER", ["hrefSchema", "targetSchema", "submissionSchema"]],
      ["DRAFT_07_HYPER", ["hrefSchema", "targetSchema", "submissionSchema", "headerSchema"]],
      ["CLOUDFLARE_DOCA", ["schema", "hrefSchema", "targetSchema", "submissionSchema", "headerSchema"]],
    ]) {
      const links = keys.map((key) => ({
        href: "/",
        rel: "self",
        [key]: { title: key, properties: { nested: { title: `${key} child` } } },
        unknown: { title: "not a schema" },
      }));
      const visitedLinks = await collectNodes({ links }, mode, vocabulary);
      assert.deepEqual(
        visitedLinks.slice(1).map((node) => node.title),
        keys.flatMap((key) => [key, `${key} child`]),
        `${mode}: ${vocabulary} visits schemas within each link`,
      );
    }
    assert.deepEqual(
      (await collectNodes({ links: [{ targetSchema: false, submissionSchema: true }] }, mode, "DRAFT_07_HYPER")).slice(
        1,
      ),
      [false, true],
    );

    const prototypeNames = JSON.parse(`{
      "__proto__": {}, "constructor": {}, "toString": {},
      "properties": {"__proto__": {"title": "own property schema"}},
      "links": [{"__proto__": {}, "constructor": {}, "targetSchema": {"title": "target"}}]
    }`);
    assert.deepEqual(
      (await collectNodes(prototypeNames, mode, "DRAFT_07_HYPER")).slice(1).map((node) => node.title),
      ["own property schema", "target"],
      `${mode}: inherited vocabulary members are ignored but own property schemas are visited`,
    );

    const nullPrototypeSchema = Object.assign(Object.create(null), { title: "null prototype" });
    const inheritedSchema = Object.assign(Object.create({ properties: { ignored: { title: "inherited" } } }), {
      items: nullPrototypeSchema,
      dependencies: { value: Object.assign(Object.create(null), { title: "dependency" }) },
    });
    assert.deepEqual(
      (await collectNodes(inheritedSchema, mode, "DRAFT_07", { cloneSchema: false }))
        .slice(1)
        .map((node) => node.title),
      ["null prototype", "dependency"],
    );

    const shared = { title: "shared" };
    const cyclic = { properties: { first: shared, second: shared } };
    shared.not = cyclic;
    assert.equal((await collectNodes(cyclic, mode)).length, 2, `${mode}: cycles and shared nodes are visited once`);

    const malformed = { properties: { bad: [], empty: null }, allOf: [[], null, { title: "valid" }], not: [] };
    assert.deepEqual(
      (await collectNodes(malformed, mode)).slice(1).map((node) => node.title),
      ["valid"],
    );

    const conditionals = { if: { title: "if" }, then: { title: "then" }, else: { title: "else" } };
    for (const vocabulary of ["DRAFT_04", "DRAFT_04_HYPER", "DRAFT_06", "DRAFT_06_HYPER"]) {
      assert.equal((await collectNodes(conditionals, mode, vocabulary)).length, 1);
    }
    for (const vocabulary of ["DRAFT_07", "DRAFT_07_HYPER"]) {
      assert.deepEqual(
        (await collectNodes(conditionals, mode, vocabulary)).slice(1).map((node) => node.title),
        ["if", "then", "else"],
      );
    }
  }

  const vocabularyWalk = collectTitlesSync({
    definitions: { named: { title: "definition", type: "number" } },
    propertyNames: { title: "propertyNames", type: "string" },
    contains: { title: "contains", type: "integer" },
    allOf: [
      { title: "allOf-one", type: "string" },
      { title: "allOf-two", type: "number" },
    ],
    dependencies: {
      listDependency: ["first", "second"],
      schemaDependency: { title: "schema-dependency", type: "object" },
    },
  });

  assert.deepEqual(
    vocabularyWalk.titles.sort(),
    ["allOf-one", "allOf-two", "contains", "definition", "propertyNames", "schema-dependency"].sort(),
  );
  assert.equal(vocabularyWalk.visited.some(Array.isArray), false);
  assert.equal(vocabularyWalk.titles.filter((title) => title === "allOf-one").length, 1);
  assert.equal(vocabularyWalk.titles.filter((title) => title === "allOf-two").length, 1);

  const source = {
    properties: { value: { $ref: "#/definitions/value" } },
    definitions: { value: { title: "resolved", type: "string" } },
  };
  const sourceBeforeDereference = structuredClone(source);
  const dereferencedWalker = new Walker();
  await dereferencedWalker.loadSchema(source, { cloneSchema: true, dereference: true });
  assert.deepEqual(source, sourceBeforeDereference);
  assert.equal(dereferencedWalker.rootSchema.properties.value.type, "string");

  const rootReference = {
    $ref: "#/definitions/value",
    title: "ignored sibling",
    minLength: 100,
    definitions: { value: { title: "referenced title", type: "string" } },
  };
  const rootReferenceBeforeDereference = structuredClone(rootReference);
  const rootWalker = new Walker();
  await rootWalker.loadSchema(rootReference, { cloneSchema: true, dereference: true });
  assert.deepEqual(rootReference, rootReferenceBeforeDereference);
  assert.equal(rootWalker.rootSchema.title, "referenced title");
  assert.equal(rootWalker.rootSchema.minLength, undefined);

  for (const mutateInputSchema of [true, false]) {
    const fullDocument = Object.freeze({
      $ref: "#/definitions/root",
      title: "ignored",
      minLength: 100,
      definitions: {
        root: {
          type: "object",
          properties: {
            self: { $ref: "#" },
            value: { $ref: "#/properties/value" },
          },
        },
      },
      properties: { value: { type: "string" } },
    });
    const before = structuredClone(fullDocument);
    const fullDocumentWalker = new Walker();
    await fullDocumentWalker.loadSchema(fullDocument, {
      cloneSchema: false,
      dereference: true,
      dereferenceOptions: { mutateInputSchema },
    });
    const root = fullDocumentWalker.rootSchema;
    assert.equal(fullDocument.$ref, "#/definitions/root");
    assert.equal(root.title, undefined);
    assert.equal(root.minLength, undefined);
    assert.equal(root.properties.value.type, "string");
    assert.equal(root.properties.self, root);
    if (!mutateInputSchema) assert.deepEqual(fullDocument, before);
  }

  for (const selfReference of ["#", "#/definitions/root"]) {
    const ignoredCircularWalker = new Walker();
    await ignoredCircularWalker.loadSchema(
      {
        $ref: "#/definitions/root",
        definitions: { root: { properties: { self: { $ref: selfReference } } } },
      },
      {
        dereference: true,
        dereferenceOptions: { dereference: { circular: "ignore" } },
      },
    );
    assert.equal(ignoredCircularWalker.rootSchema.$ref, "#/definitions/root");
    assert.equal(ignoredCircularWalker.rootSchema.definitions.root.properties.self.$ref, selfReference);
    assert.doesNotThrow(() => JSON.stringify(ignoredCircularWalker.rootSchema));
  }

  for (const draft of ["2019-09", "2020-12"]) {
    const urls = [];
    const modernWalker = new Walker();
    await modernWalker.loadSchema(
      {
        $schema: `https://json-schema.org/draft/${draft}/schema`,
        $id: "https://example.com/schemas/root.json",
        $ref: "#/definitions/root",
        minLength: 3,
        definitions: { root: { $ref: "child.json" } },
      },
      {
        dereference: true,
        dereferenceOptions: {
          resolve: {
            file: false,
            http: false,
            child: {
              order: 1,
              canRead: () => true,
              read: (file) => {
                urls.push(file.url);
                return { type: "string" };
              },
            },
          },
        },
      },
    );
    assert.deepEqual(urls, ["https://example.com/schemas/child.json"]);
    assert.equal(modernWalker.rootSchema.type, "string");
    assert.equal(modernWalker.rootSchema.minLength, 3);
  }

  const circularWalker = new Walker();
  await circularWalker.loadSchema({ properties: { self: { $ref: "#" } } }, { cloneSchema: true, dereference: true });
  let circularVisitCount = 0;
  circularWalker.walkSync(() => {
    circularVisitCount += 1;
  }, circularWalker.vocabularies.DRAFT_07);
  assert.equal(circularVisitCount, 1);

  console.log("json-schema-walker regression tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
