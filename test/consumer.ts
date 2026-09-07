import { Walker, type InputSchema, type Options } from "../dist/index.js";

const walker = new Walker();
const options: Options = {
  dereference: true,
  dereferenceOptions: { dereference: { circular: "ignore" } },
};

walker.loadSchemaSync(false);
walker.walkSync((schema) => {
  const visited: InputSchema = schema;
  if (typeof visited === "object") {
    visited.title = "visited";
  }
});

void walker.loadSchema(true, options);
void walker.walk(() => {});

walker.loadSchemaSync({ properties: { allowed: true, forbidden: false } });
walker.walkSync(() => {}, walker.vocabularies.DRAFT_07);

const booleanWalker = new Walker<boolean>();
booleanWalker.loadSchemaSync(true);
booleanWalker.walkSync(() => {});
