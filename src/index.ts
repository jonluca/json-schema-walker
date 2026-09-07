import type { JSONSchema, ParserOptions } from "@apidevtools/json-schema-ref-parser" with {
  "resolution-mode": "import",
};
import type { JSONSchema4 } from "json-schema";
import type { JSONSchema6, JSONSchema7 } from "json-schema";

const NEXT_SCHEMA_KEYWORD: unique symbol = Symbol("NEXT_SCHEMA_KEYWORD");
const NEXT_LDO_KEYWORD: unique symbol = Symbol("NEXT_LDO_KEYWORD");

const cloneSchemaValue = <T>(value: T): T => {
  const structuredCloneFn = (globalThis as typeof globalThis & { structuredClone?: <U>(input: U) => U })
    .structuredClone;

  if (structuredCloneFn) {
    return structuredCloneFn(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
};

export type InputSchema = JSONSchema | boolean;

export type ProcessorFunction<T> = (schema: T) => void;

export type ProcessorFunctionInternal = (schema: ISubSchema, keyword: string | number) => void;

export type IVocabulary = Record<string, any>;
export type ISubSchema = Record<string, any>;
export interface Options {
  cloneSchema?: boolean;
  dereference?: boolean;
  dereferenceOptions?: ParserOptions | undefined;
}

export interface OptionsSync {
  cloneSchema?: boolean;
}

const getLegacyRootReference = (input: Record<string, any>) => {
  const legacyDialect =
    !input.$schema || /^https?:\/\/json-schema\.org\/draft-(?:04|06|07)\/schema#?$/.test(input.$schema);
  return legacyDialect &&
    typeof input.$ref === "string" &&
    input.$ref.startsWith("#/definitions/") &&
    input.definitions &&
    typeof input.definitions === "object"
    ? input.$ref
    : undefined;
};

const replaceDocumentRoot = (root: unknown, document: object) => {
  const pending = [root];
  const visited = new WeakSet<object>();
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== "object" || visited.has(value)) {
      continue;
    }
    visited.add(value);
    for (const key of Object.keys(value)) {
      const object = value as Record<string, unknown>;
      if (object[key] === document) {
        object[key] = root;
      } else {
        pending.push(object[key]);
      }
    }
  }
};

export class Walker<T extends InputSchema = InputSchema> {
  rootSchema!: T;
  vocabulary!: IVocabulary;
  vocabularies!: Record<string, IVocabulary>;
  walker!: ProcessorFunction<T>;
  private visitedSchemas = new WeakSet<object>();

  constructor() {
    this.initVocabulary();
  }

  loadSchema = async (schema: T, options?: Options) => {
    const { cloneSchema = true, dereference = false, dereferenceOptions } = options || {};
    this.rootSchema = cloneSchema ? cloneSchemaValue(schema) : schema;
    if (dereference && typeof this.rootSchema === "object") {
      const { $RefParser } = await import("@apidevtools/json-schema-ref-parser");
      const parser = new $RefParser();
      const rootReference = getLegacyRootReference(this.rootSchema as Record<string, any>);
      if (rootReference) {
        // Retain the complete document for JSON Pointer lookup, while excluding ignored root siblings
        // from the referenced schema. A shallow copy also leaves the caller's root $ref intact.
        const document = { ...this.rootSchema } as Record<string, any>;
        delete document.$ref;
        const dereferencedDocument = await parser.dereference(document, dereferenceOptions || {});
        if (dereferenceOptions?.dereference?.circular === "ignore" && parser.$refs.circular) {
          // Unresolved circular pointers still need the original document and its definitions.
          dereferencedDocument.$ref = rootReference;
          this.rootSchema = dereferencedDocument as T;
        } else {
          const root = parser.$refs.get(rootReference);
          // A nested reference to "#" must point to the selected schema, not its source document.
          replaceDocumentRoot(root, dereferencedDocument);
          this.rootSchema = root as T;
        }
      } else {
        this.rootSchema = (await parser.dereference(this.rootSchema, dereferenceOptions || {})) as T;
      }
    }
  };

  loadSchemaSync = (schema: T, options?: OptionsSync) => {
    const { cloneSchema = true } = options || {};
    this.rootSchema = cloneSchema ? cloneSchemaValue(schema) : schema;
  };

  walk = async (processor: ProcessorFunction<T>, vocabulary?: IVocabulary) => {
    this.vocabulary = vocabulary ?? this.vocabularies.DRAFT_07;
    this.walker = processor;
    this.visitedSchemas = new WeakSet<object>();
    if (this.rootSchema && typeof this.rootSchema === "object") {
      this.visitedSchemas.add(this.rootSchema);
    }
    this.walker(this.rootSchema);
    await this.subschemaWalk(this.rootSchema);
  };

  walkSync = (processor: ProcessorFunction<T>, vocabulary?: IVocabulary) => {
    this.vocabulary = vocabulary ?? this.vocabularies.DRAFT_07;
    this.walker = processor;
    this.visitedSchemas = new WeakSet<object>();
    if (this.rootSchema && typeof this.rootSchema === "object") {
      this.visitedSchemas.add(this.rootSchema);
    }
    this.walker(this.rootSchema);
    this.subschemaWalk(this.rootSchema);
  };

  private isValidSubSchema = (schema: unknown) =>
    (schema !== null && typeof schema === "object" && !Array.isArray(schema)) || typeof schema === "boolean";

  private applyUserProcessor = (schema: ISubSchema, key: string | number) => {
    const schemaElement = schema[key];
    if (!this.isValidSubSchema(schemaElement)) {
      return;
    }
    if (typeof schemaElement === "boolean") {
      this.walker(schemaElement as T);
      return;
    }
    if (this.visitedSchemas.has(schemaElement)) {
      return;
    }
    this.visitedSchemas.add(schemaElement);

    this.walker(schemaElement);
    this.subschemaWalk(schemaElement);
  };

  private subschemaWalk = (schema: InputSchema) => {
    if (typeof schema === "boolean") {
      return;
    }
    for (const keyword of Object.keys(schema)) {
      try {
        this.processSchemaKey(schema, keyword);
      } catch (e) {
        if (e !== NEXT_SCHEMA_KEYWORD) {
          throw e;
        }
      }
    }
  };

  // These are the processors
  private processSchemaKey = (schema: ISubSchema, keyword: string) => {
    const value = schema[keyword];
    if (value === null || (typeof value !== "object" && typeof value !== "boolean")) {
      return;
    }
    if (!Object.hasOwn(this.vocabulary, keyword)) {
      return;
    }
    const processorFunction = this.vocabulary[keyword];
    if (typeof processorFunction !== "function") {
      return;
    }
    processorFunction(schema, keyword);
  };
  private processObjectOfSchemas = (schema: ISubSchema, keyword: string) => {
    for (const prop of Object.getOwnPropertyNames(schema[keyword])) {
      this.applyUserProcessor(schema[keyword], prop);
    }
  };
  private processArrayOfSchemas = (schema: ISubSchema, keyword: string) => {
    if (!Array.isArray(schema[keyword])) {
      return;
    }
    for (let i = 0; i < schema[keyword].length; i++) {
      this.applyUserProcessor(schema[keyword], i);
    }
  };
  private processDependencies = (schema: ISubSchema, keyword: string) => {
    for (const prop of Object.getOwnPropertyNames(schema[keyword])) {
      if (this.isValidSubSchema(schema[keyword][prop])) {
        this.applyUserProcessor(schema[keyword], prop);
      }
    }
  };
  private processSingleOrArrayOfSchemas = (schema: ISubSchema, keyword: string) => {
    if (this.isValidSubSchema(schema[keyword])) {
      this.processSingleSchema(schema, keyword);
    } else {
      this.processArrayOfSchemas(schema, keyword);
    }
  };

  private processSingleSchema = (schema: ISubSchema, keyword: string) => {
    this.applyUserProcessor(schema, keyword);
  };

  /**
   * Loop over the links and apply the callbacks, while
   * handling LDO keyword deletions by catching NEXT_LDO_KEYWORD.
   */
  private getProcessLinks = (ldoVocabulary: IVocabulary) => {
    return (schema: ISubSchema, keyword: string | number) => {
      if (!Array.isArray(schema[keyword])) {
        return;
      }
      for (const ldo of schema[keyword]) {
        if (!ldo || typeof ldo !== "object" || Array.isArray(ldo)) {
          continue;
        }
        for (const key of Object.keys(ldo)) {
          try {
            if (Object.hasOwn(ldoVocabulary, key) && typeof ldoVocabulary[key] === "function") {
              ldoVocabulary[key](ldo, key);
            }
          } catch (e) {
            if (e !== NEXT_LDO_KEYWORD) {
              throw e;
            }
          }
        }
      }
    };
  };

  // vocabulary initialization
  private initVocabulary = () => {
    const DRAFT_04 = {
      properties: this.processObjectOfSchemas,
      patternProperties: this.processObjectOfSchemas,
      definitions: this.processObjectOfSchemas,
      additionalProperties: this.processSingleSchema,
      dependencies: this.processDependencies,
      items: this.processSingleOrArrayOfSchemas,
      additionalItems: this.processSingleSchema,
      allOf: this.processArrayOfSchemas,
      anyOf: this.processArrayOfSchemas,
      oneOf: this.processArrayOfSchemas,
      not: this.processSingleSchema,
    } as Record<keyof JSONSchema4, ProcessorFunctionInternal>;

    /**
     * LDO keywords call _apply directly as they have a different
     * mapping from the schema keyword into the path that _apply
     * expects.  This is done in the function returned from
     * _getProcessLinks();
     */
    const DRAFT_04_HYPER_LDO = {
      schema: this.applyUserProcessor,
      targetSchema: this.applyUserProcessor,
    };

    const DRAFT_04_HYPER = {
      ...DRAFT_04,
      links: this.getProcessLinks(DRAFT_04_HYPER_LDO),
    } as Record<string, ProcessorFunctionInternal>;

    const DRAFT_06 = {
      ...DRAFT_04,
      propertyNames: this.processSingleSchema,
      contains: this.processSingleSchema,
    } as Record<keyof JSONSchema6, ProcessorFunctionInternal>;

    const DRAFT_06_HYPER_LDO = {
      hrefSchema: this.applyUserProcessor,
      targetSchema: this.applyUserProcessor,
      submissionSchema: this.applyUserProcessor,
    };

    const DRAFT_06_HYPER = {
      ...DRAFT_06,
      links: this.getProcessLinks(DRAFT_06_HYPER_LDO),
    } as Record<keyof JSONSchema6, ProcessorFunctionInternal>;

    const DRAFT_07 = {
      ...DRAFT_06,
      if: this.processSingleSchema,
      then: this.processSingleSchema,
      else: this.processSingleSchema,
    } as Record<keyof JSONSchema7, ProcessorFunctionInternal>;

    const DRAFT_07_HYPER_LDO = {
      ...DRAFT_06_HYPER_LDO,
      headerSchema: this.applyUserProcessor,
    } as Record<string, ProcessorFunctionInternal>;

    const DRAFT_07_HYPER = {
      ...DRAFT_07,
      links: this.getProcessLinks(DRAFT_07_HYPER_LDO),
    } as Record<string, ProcessorFunctionInternal>;

    const CLOUDFLARE_DOCA = {
      ...DRAFT_04,
      links: this.getProcessLinks({
        ...DRAFT_04_HYPER_LDO,
        ...DRAFT_07_HYPER_LDO,
      }),
    } as Record<string, ProcessorFunctionInternal>;
    this.vocabularies = {
      DRAFT_04,
      DRAFT_04_HYPER,
      DRAFT_04_HYPER_LDO,
      DRAFT_06,
      DRAFT_06_HYPER,
      DRAFT_06_HYPER_LDO,
      DRAFT_07,
      DRAFT_07_HYPER,
      DRAFT_07_HYPER_LDO,
      CLOUDFLARE_DOCA,
    } as const;
  };
}
