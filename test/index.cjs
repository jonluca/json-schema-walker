const assert = require("node:assert/strict");
const { Walker } = require("../dist/index.js");

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
