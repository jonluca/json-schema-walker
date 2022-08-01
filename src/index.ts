import type { JSONSchema } from "@apidevtools/json-schema-ref-parser";
import clone from "clone";
import RefParser from "@apidevtools/json-schema-ref-parser";
import type $RefParser from "@apidevtools/json-schema-ref-parser";
import type { JSONSchema4 } from "json-schema";
import type { JSONSchema6, JSONSchema7 } from "json-schema";

const visited: unique symbol = Symbol("visited");
const NEXT_SCHEMA_KEYWORD: unique symbol = Symbol("NEXT_SCHEMA_KEYWORD");
const NEXT_LDO_KEYWORD: unique symbol = Symbol("NEXT_LDO_KEYWORD");

type InputSchema = JSONSchema;

type ProcessorFunction<T> = (schema: T) => void;

type ProcessorFunctionInternal = (schema: ISubSchema, keyword: string | number) => void;

type IVocabulary = Record<string, any>;
type ISubSchema = Record<string, any>;
interface Options<T extends InputSchema> {
  cloneSchema?: boolean;
  dereference?: boolean;
  dereferenceOptions?: $RefParser.Options;
}

/**
 * This is a hotfix and really only a partial solution as it does not cover all cases.
 *
 * But it's the best we can do until we find or build a better library to handle references.
 *
 * original source https://github.com/asyncapi/modelina/pull/829/files
 */
const handleRootReference = <T extends Record<string, any> = Record<string, any>>(input: Record<string, any>): T => {
  //Because of https://github.com/APIDevTools/json-schema-ref-parser/issues/201 the tool cannot handle root references.
  //This really is a bad patch to fix an underlying problem, but until a full library is available, this is best we can do.
  const hasRootRef = input.$ref !== undefined;
  if (hasRootRef) {
    //When we encounter it, manually try to resolve the reference in the definitions section
    const hasDefinitionSection = input.definitions !== undefined;
    if (hasDefinitionSection) {
      const definitionLink = "#/definitions/";
      const referenceLink = input.$ref.slice(0, definitionLink.length);
      const referenceIsLocal = referenceLink === definitionLink;
      if (referenceIsLocal) {
        const definitionName = input.$ref.slice(definitionLink.length);
        const definition = input.definitions[String(definitionName)];
        const definitionExist = definition !== undefined;
        if (definitionExist) {
          delete input.$ref;
          return { ...definition, ...input };
        }
      }
    }
  }
  return input as T;
};

export class Walker<T extends InputSchema = InputSchema> {
  rootSchema!: T;
  vocabulary!: IVocabulary;
  vocabularies!: Record<string, IVocabulary>;
  walker!: ProcessorFunction<T>;

  constructor() {
    this.initVocabulary();
  }

  loadSchema = async (schema: T, options?: Options<T>) => {
    const { cloneSchema = true, dereference = false, dereferenceOptions } = options || {};
    this.rootSchema = cloneSchema ? clone(schema) : schema;
    if (dereference) {
      const parser = new RefParser();
      this.rootSchema = (await parser.dereference(handleRootReference(schema), dereferenceOptions || {})) as T;
    }
  };

  walk = async (processor: ProcessorFunction<T>, vocabulary: IVocabulary) => {
    this.vocabulary = vocabulary ?? this.vocabularies.DRAFT_07;
    this.walker = processor;
    this.walker(this.rootSchema);
    await this.subschemaWalk(this.rootSchema);
    // clean up the symbols we injected to check for circular references
    this.cleanupVisited(this.rootSchema);
  };

  private cleanupVisited = (schema: ISubSchema) => {
    for (const entry of Object.values(schema)) {
      if (typeof entry === "object" && entry[visited]) {
        delete entry[visited];
        this.cleanupVisited(entry);
      }
    }
  };

  private isValidSubSchema = (schema: unknown) =>
    (schema instanceof Object && !Array.isArray(schema)) || typeof schema === "boolean";

  private applyUserProcessor = (schema: ISubSchema, key: string | number) => {
    const schemaElement = schema[key];
    if (typeof schemaElement !== "object") {
      return;
    }
    schemaElement[visited] = true;

    this.walker(schemaElement);
    this.subschemaWalk(schemaElement);
  };

  private subschemaWalk = (schema: ISubSchema) => {
    for (const keyword in schema) {
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
    if (typeof schema[keyword] !== "object") {
      return;
    }
    const processorFunction = this.vocabulary[keyword];
    if (!processorFunction) {
      return;
    }
    schema[keyword][visited] = true;
    processorFunction(schema, keyword);
  };
  private processObjectOfSchemas = (schema: ISubSchema, keyword: string) => {
    for (const prop of Object.getOwnPropertyNames(schema[keyword])) {
      if (typeof schema[keyword][prop] === "object") {
        this.applyUserProcessor(schema[keyword], prop);
      }
    }
  };
  private processArrayOfSchemas = (schema: ISubSchema, keyword: string) => {
    for (const prop of Object.getOwnPropertyNames(schema[keyword])) {
      if (typeof schema[keyword][prop] === "object") {
        this.applyUserProcessor(schema[keyword], prop);
      }
    }
    for (let i = 0; i < schema[keyword].length; i++) {
      this.applyUserProcessor(schema[keyword], i);
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
      for (const ldo of schema.links) {
        for (const key in ldo) {
          try {
            ldoVocabulary[keyword]?.(schema, key);
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
      additionalProperties: this.processSingleSchema,
      dependencies: this.processObjectOfSchemas,
      items: this.processSingleOrArrayOfSchemas,
      additionalItems: this.processSingleSchema,
      allOf: this.processArrayOfSchemas,
      anyOf: this.processArrayOfSchemas,
      oneOf: this.processArrayOfSchemas,
      not: this.processSingleSchema,
      if: this.processSingleSchema,
      then: this.processSingleSchema,
      else: this.processSingleSchema,
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
      propertyNames: this.processObjectOfSchemas,
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

    const DRAFT_07 = { ...DRAFT_06 } as Record<keyof JSONSchema7, ProcessorFunctionInternal>;

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
