import {
  ESpanKind,
  type Fixed64,
  type IAnyValue,
  type IExportTraceServiceRequest,
  type IInstrumentationScope,
  type IKeyValue,
  type ISpan,
} from "@opentelemetry/otlp-transformer";
import { cloneDeep } from "lodash";
import type { DeepPartial } from "../../utils/types";
import type { CollectorJob } from "../background/types";
import type {
  BaseSpan,
  LLMSpan,
  Span,
  SpanTypes,
  TypedValueChatMessages,
} from "./types";
import {
  customMetadataSchema,
  reservedTraceMetadataSchema,
  spanTypesSchema,
  typedValueChatMessagesSchema,
} from "./types.generated";

export type TraceForCollection = Pick<
  CollectorJob,
  "traceId" | "spans" | "reservedTraceMetadata" | "customMetadata"
>;

export const openTelemetryTraceRequestToTracesForCollection = (
  otelTrace: DeepPartial<IExportTraceServiceRequest>
): TraceForCollection[] => {
  // A single otelTrace may contain multiple traces with multiple spans each,
  // we need to account for that, that's why it's always one otelTrace to many traces
  decodeOpenTelemetryIds(otelTrace);

  const traceIds = Array.from(
    new Set(
      otelTrace.resourceSpans?.flatMap((resourceSpan) => {
        return (
          resourceSpan?.scopeSpans?.flatMap((scopeSpan) => {
            return (
              scopeSpan?.spans?.flatMap((span) => span?.traceId as string) ?? []
            );
          }) ?? []
        );
      }) ?? []
    )
  );

  const traces: TraceForCollection[] = traceIds.map((traceId) =>
    openTelemetryTraceRequestToTraceForCollection(traceId, {
      resourceSpans: otelTrace.resourceSpans?.filter(
        (resourceSpan) =>
          resourceSpan?.scopeSpans?.some(
            (scopeSpan) =>
              scopeSpan?.spans?.some((span) => span?.traceId === traceId)
          )
      ),
    })
  );

  return traces;
};

const decodeOpenTelemetryIds = (
  otelTrace: DeepPartial<IExportTraceServiceRequest>
) => {
  for (const resourceSpan of otelTrace.resourceSpans ?? []) {
    for (const scopeSpan of resourceSpan?.scopeSpans ?? []) {
      for (const span of scopeSpan?.spans ?? []) {
        if (span?.traceId) {
          span.traceId = Buffer.from(span.traceId as string, "base64").toString(
            "hex"
          );
        }
        if (span?.spanId) {
          span.spanId = Buffer.from(span.spanId as string, "base64").toString(
            "hex"
          );
        }
        if (span?.parentSpanId) {
          span.parentSpanId = Buffer.from(
            span.parentSpanId as string,
            "base64"
          ).toString("hex");
        }
      }
    }
  }
};

const openTelemetryTraceRequestToTraceForCollection = (
  traceId: string,
  otelTrace_: DeepPartial<IExportTraceServiceRequest>
): TraceForCollection => {
  const otelTrace = cloneDeep(otelTrace_);

  const customMetadata: Record<string, any> = {};
  for (const resourceSpan of otelTrace.resourceSpans ?? []) {
    for (const attribute of resourceSpan?.resource?.attributes ?? []) {
      if (attribute?.key) {
        customMetadata[attribute.key] = attribute?.value?.stringValue;
      }
    }
  }

  const trace: TraceForCollection = {
    traceId,
    spans: [],
    reservedTraceMetadata: {},
    customMetadata,
  };

  for (const resourceSpan of otelTrace.resourceSpans ?? []) {
    for (const scopeSpan of resourceSpan?.scopeSpans ?? []) {
      for (const span of scopeSpan?.spans ?? []) {
        if (span?.traceId === traceId) {
          addOpenTelemetrySpanAsSpan(trace, span, scopeSpan?.scope);
        }
      }
    }
  }

  return trace;
};

const allowedSpanTypes = spanTypesSchema.options.map((option) => option.value);

const parseTimestamp = (
  timestamp: DeepPartial<Fixed64> | undefined
): number | undefined => {
  const unixNano =
    typeof timestamp === "number"
      ? timestamp
      : typeof timestamp === "string"
      ? parseInt(timestamp, 10)
      : maybeConvertLongBits(timestamp);

  return unixNano ? Math.round(unixNano / 1000 / 1000) : undefined;
};

const addOpenTelemetrySpanAsSpan = (
  trace: TraceForCollection,
  otelSpan: DeepPartial<ISpan>,
  otelScope: DeepPartial<IInstrumentationScope> | undefined
): void => {
  let type: Span["type"] = "span";
  let model: LLMSpan["model"] = undefined;
  let input: LLMSpan["input"] = null;
  let output: LLMSpan["output"] = null;
  let params: Span["params"] = {};
  const started_at: Span["timestamps"]["started_at"] | undefined =
    parseTimestamp(otelSpan.startTimeUnixNano);
  const finished_at: Span["timestamps"]["finished_at"] | undefined =
    parseTimestamp(otelSpan.endTimeUnixNano);
  let error: Span["error"] = null;

  // First token at
  let first_token_at: Span["timestamps"]["first_token_at"] = null;
  for (const event of otelSpan?.events ?? []) {
    if (
      event?.name === "First Token Stream Event" ||
      event?.name === "llm.content.completion.chunk"
    ) {
      first_token_at = parseTimestamp(event?.timeUnixNano);
      break;
    }
  }

  // Type
  if (
    (otelSpan.kind as any) === "SPAN_KIND_SERVER" ||
    otelSpan.kind === ESpanKind.SPAN_KIND_SERVER
  ) {
    type = "server";
  }
  if (
    (otelSpan.kind as any) === "SPAN_KIND_CLIENT" ||
    otelSpan.kind === ESpanKind.SPAN_KIND_CLIENT
  ) {
    type = "client";
  }
  if (
    (otelSpan.kind as any) === "SPAN_KIND_PRODUCER" ||
    otelSpan.kind === ESpanKind.SPAN_KIND_PRODUCER
  ) {
    type = "producer";
  }
  if (
    (otelSpan.kind as any) === "SPAN_KIND_CONSUMER" ||
    otelSpan.kind === ESpanKind.SPAN_KIND_CONSUMER
  ) {
    type = "consumer";
  }

  const attributesMap = keyValueToObject(otelSpan.attributes);
  if (attributesMap.openinference?.span?.kind) {
    const kind_ = attributesMap.openinference.span.kind.toLowerCase();
    if (allowedSpanTypes.includes(kind_ as SpanTypes)) {
      type = kind_ as SpanTypes;
      delete attributesMap.openinference.span.kind;
    }
  }

  if (attributesMap.traceloop?.span?.kind) {
    const kind_ = attributesMap.traceloop.span.kind.toLowerCase();
    if (allowedSpanTypes.includes(kind_ as SpanTypes)) {
      type = kind_ as SpanTypes;
      delete attributesMap.traceloop.span.kind;
    }
  }

  if (
    attributesMap.llm?.request?.type === "chat" ||
    attributesMap.llm?.request?.type === "completion"
  ) {
    type = "llm";
    delete attributesMap.llm.request.type;
  }

  // Model
  if (attributesMap.llm?.model_name) {
    model = attributesMap.llm.model_name;
    delete attributesMap.llm.model_name;
  }

  if (attributesMap.gen_ai?.request?.model) {
    model = attributesMap.gen_ai.request.model;
    delete attributesMap.gen_ai.request.model;
  }

  if (attributesMap.gen_ai?.response?.model) {
    model = attributesMap.gen_ai.response.model;
    delete attributesMap.gen_ai.response.model;
  }

  // Input
  if (
    attributesMap.llm?.input_messages &&
    Array.isArray(attributesMap.llm.input_messages)
  ) {
    const input_ = typedValueChatMessagesSchema.safeParse({
      type: "chat_messages",
      value: attributesMap.llm.input_messages.map(
        (message: { message?: string }) => message.message
      ),
    });

    if (input_.success) {
      input = input_.data as TypedValueChatMessages;
      delete attributesMap.llm.input_messages;
    }
  }

  if (
    !input &&
    attributesMap.gen_ai?.prompt &&
    Array.isArray(attributesMap.gen_ai.prompt)
  ) {
    const input_ = typedValueChatMessagesSchema.safeParse({
      type: "chat_messages",
      value: attributesMap.gen_ai.prompt,
    });

    if (input_.success) {
      input = input_.data as TypedValueChatMessages;
      delete attributesMap.gen_ai.prompt;
    }
  }

  if (!input && attributesMap.traceloop?.entity?.input) {
    input =
      typeof attributesMap.traceloop.entity.input === "string"
        ? {
            type: "text",
            value: attributesMap.traceloop.entity.input,
          }
        : {
            type: "json",
            value: attributesMap.traceloop.entity.input,
          };

    // Check for langchain metadata inside traceloop https://github.com/traceloop/openllmetry/issues/1783
    const json = attributesMap.traceloop.entity.input;
    if (
      input.type === "json" &&
      typeof json === "object" &&
      json !== null &&
      "metadata" in json
    ) {
      // @ts-ignore
      const metadata = json.metadata;
      const reservedTraceMetadata = Object.fromEntries(
        Object.entries(reservedTraceMetadataSchema.parse(metadata)).filter(
          ([_key, value]) => value !== null && value !== undefined
        )
      );
      const remainingMetadata = Object.fromEntries(
        Object.entries(metadata).filter(
          ([key]) => !(key in reservedTraceMetadataSchema.shape)
        )
      );
      const customMetadata = customMetadataSchema.parse(remainingMetadata);

      if (Object.keys(reservedTraceMetadata).length > 0) {
        trace.reservedTraceMetadata = {
          ...trace.reservedTraceMetadata,
          ...reservedTraceMetadata,
        };
      }

      if (Object.keys(customMetadata).length > 0) {
        trace.customMetadata = {
          ...trace.customMetadata,
          ...customMetadata,
        };
      }

      // @ts-ignore
      delete json.metadata;
    }
    delete attributesMap.traceloop.entity.input;
  }

  if (!input && attributesMap.input?.value) {
    input =
      typeof attributesMap.input.value === "string"
        ? {
            type: "text",
            value: attributesMap.input.value,
          }
        : {
            type: "json",
            value: attributesMap.input.value,
          };
  }
  delete attributesMap.input;

  // Output
  if (
    attributesMap.llm?.output_messages &&
    Array.isArray(attributesMap.llm.output_messages)
  ) {
    const output_ = typedValueChatMessagesSchema.safeParse({
      type: "chat_messages",
      value: attributesMap.llm.output_messages.map(
        (message: { message?: string }) => message.message
      ),
    });

    if (output_.success) {
      output = output_.data as TypedValueChatMessages;
      delete attributesMap.llm.output_messages;
    }
  }

  if (
    !output &&
    attributesMap.gen_ai?.completion &&
    Array.isArray(attributesMap.gen_ai.completion)
  ) {
    const output_ = typedValueChatMessagesSchema.safeParse({
      type: "chat_messages",
      value: attributesMap.gen_ai.completion,
    });

    if (output_.success) {
      output = output_.data as TypedValueChatMessages;
      delete attributesMap.gen_ai.completion;
    }
  }

  if (!output && attributesMap.llm?.output_messages) {
    output =
      typeof attributesMap.llm.output_messages === "string"
        ? {
            type: "text",
            value: attributesMap.llm.output_messages,
          }
        : {
            type: "json",
            value: attributesMap.llm.output_messages,
          };
    delete attributesMap.llm.output_messages;
  }

  if (!output && attributesMap.traceloop?.entity?.output) {
    output =
      typeof attributesMap.traceloop.entity.output === "string"
        ? {
            type: "text",
            value: attributesMap.traceloop.entity.output,
          }
        : {
            type: "json",
            value: attributesMap.traceloop.entity.output,
          };
    delete attributesMap.traceloop.entity.output;
  }

  if (!output && attributesMap.output?.value) {
    output =
      typeof attributesMap.output.value === "string"
        ? {
            type: "text",
            value: attributesMap.output.value,
          }
        : {
            type: "json",
            value: attributesMap.output.value,
          };
  }
  delete attributesMap.output;

  // Metadata
  if (attributesMap.user?.id) {
    trace.reservedTraceMetadata.user_id = attributesMap.user.id;
    delete attributesMap.user.id;
  }

  if (attributesMap.session?.id) {
    trace.reservedTraceMetadata.thread_id = attributesMap.session.id;
    delete attributesMap.session.id;
  }

  if (attributesMap.tag?.tags && Array.isArray(attributesMap.tag.tags)) {
    trace.reservedTraceMetadata.labels = attributesMap.tag.tags;
    delete attributesMap.tag.tags;
  }

  if (
    attributesMap.metadata &&
    typeof attributesMap.metadata === "object" &&
    !Array.isArray(attributesMap.metadata)
  ) {
    trace.customMetadata = {
      ...trace.customMetadata,
      ...(attributesMap.metadata as Record<string, any>),
    };
    delete attributesMap.metadata;
  }

  // Params
  if (attributesMap.llm?.invocation_parameters) {
    params = {
      ...params,
      ...(attributesMap.llm.invocation_parameters as Record<string, any>),
    };
    delete attributesMap.llm.invocation_parameters;
  }

  if (attributesMap.llm?.is_streaming) {
    params = {
      ...params,
      stream:
        attributesMap.llm.is_streaming &&
        attributesMap.llm.is_streaming !== "false" &&
        attributesMap.llm.is_streaming !== "False",
    };
    delete attributesMap.llm.is_streaming;
  }

  params = {
    ...params,
    ...removeEmptyKeys(attributesMap),
    ...(otelScope ? { scope: otelScope } : {}),
  };

  // Exception
  if (
    (otelSpan.status?.code as any) === "STATUS_CODE_ERROR" ||
    (otelSpan.status?.code as any) === 2 // EStatusCode.STATUS_CODE_ERROR
  ) {
    error = {
      has_error: true,
      message: otelSpan.status?.message ?? "Exception",
      stacktrace: [],
    };
  }

  for (const event of otelSpan?.events ?? []) {
    if (event?.name === "exception") {
      const eventAttributes = keyValueToObject(event?.attributes);
      error = {
        has_error: true,
        message:
          eventAttributes.exception?.message && eventAttributes.exception?.type
            ? `${eventAttributes.exception.type}: ${eventAttributes.exception.message}`
            : eventAttributes.exception?.message &&
              eventAttributes.exception?.type
            ? `${eventAttributes.exception.type}: ${eventAttributes.exception.message}`
            : otelSpan.status?.message ?? "Exception",
        stacktrace: eventAttributes.exception?.stacktrace
          ? (eventAttributes.exception?.stacktrace as string).split("\n")
          : [],
      };
    }
  }

  const span: BaseSpan & { model: LLMSpan["model"] } = {
    span_id: otelSpan.spanId as string,
    trace_id: otelSpan.traceId as string,
    ...(otelSpan.parentSpanId
      ? { parent_id: otelSpan.parentSpanId as string }
      : {}),
    name: otelSpan.name,
    type,
    model,
    input,
    output,
    ...(error ? { error } : {}),
    params,
    timestamps: {
      ...(started_at ? { started_at } : {}),
      ...(finished_at ? { finished_at } : {}),
      ...(first_token_at ? { first_token_at } : {}),
    } as Span["timestamps"],
  };

  trace.spans.push(span);
};

type RecursiveRecord = {
  [key: string]: (RecursiveRecord & string) | undefined;
};

const keyValueToObject = (
  attributes: DeepPartial<IKeyValue[]> | undefined
): RecursiveRecord => {
  const result: RecursiveRecord = {};

  attributes?.forEach(
    (
      key_value: { key?: string; value?: DeepPartial<IAnyValue> } | undefined
    ) => {
      if (!key_value) return;
      const { key, value } = key_value;

      const keys = key?.split(".");
      let current = result;

      keys?.forEach((k, i) => {
        if (i === keys.length - 1) {
          current[k] = iAnyValueToValue(value);
        } else {
          if (/^\d+$/.test(keys[i + 1]!)) {
            // Next key is a number, so this should be an array
            current[k] = current[k] ?? ([] as any);
          } else {
            current[k] = current[k] ?? ({} as any);
          }
          current = current[k] as any;
        }
      });
    }
  );

  // Convert numbered object keys to arrays
  const convertToArrays = (obj: Record<string, any>): any => {
    for (const key in obj) {
      if (typeof obj[key] === "object" && obj[key] !== null) {
        obj[key] = convertToArrays(obj[key]);
        if (Object.keys(obj[key]).every((k) => /^\d+$/.test(k))) {
          obj[key] = Object.values(obj[key]);
        }
      }
    }
    return obj;
  };

  return convertToArrays(result);
};

const maybeConvertLongBits = (value: any): number => {
  if (value && typeof value === "object" && "high" in value && "low" in value) {
    const { high, low, unsigned } = value;

    // Create a BigInt from the high and low bits
    const result = (BigInt(high) << 32n) | (BigInt(low) & 0xffffffffn);

    // If it's an unsigned long, return it as is
    if (unsigned) {
      return Number(result);
    }

    // For signed longs, we need to handle the two's complement representation
    const signBit = 1n << 63n;
    if (result & signBit) {
      // If the sign bit is set, it's a negative number
      return Number(-(~result & ((1n << 64n) - 1n)) - 1n);
    } else {
      // If the sign bit is not set, it's a positive number
      return Number(result);
    }
  }
  return value;
};

const iAnyValueToValue = (value: DeepPartial<IAnyValue> | undefined): any => {
  if (typeof value === "undefined") return undefined;

  if (value.stringValue) {
    if (value.stringValue === "None") {
      return null; // badly parsed python null by openllmetry
    }
    // Try to parse JSON if possible
    try {
      return JSON.parse(value.stringValue);
    } catch {
      return value.stringValue;
    }
  }
  if (value.arrayValue) {
    return value.arrayValue?.values?.map((v) => iAnyValueToValue(v));
  }
  if (value.boolValue) {
    return value.boolValue;
  }
  if (value.intValue) {
    return maybeConvertLongBits(value.intValue);
  }
  if (value.doubleValue) {
    return maybeConvertLongBits(value.doubleValue);
  }
  if (value.bytesValue) {
    return Buffer.from(value.bytesValue as Uint8Array).toString("base64");
  }
  if (value.kvlistValue) {
    return Object.fromEntries(
      value.kvlistValue?.values?.map(
        (v: DeepPartial<IKeyValue> | undefined) => [
          v?.key,
          iAnyValueToValue(v?.value),
        ]
      ) ?? []
    );
  }
};

const removeEmptyKeys = (obj: Record<string, any>): Record<string, any> => {
  const isEmptyObject = (value: any): boolean =>
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0;

  const isEmptyArray = (value: any): boolean =>
    Array.isArray(value) && value.length === 0;

  const isEmpty = (value: any): boolean =>
    value === null ||
    value === undefined ||
    isEmptyObject(value) ||
    isEmptyArray(value);

  if (!obj) return obj;

  if (typeof obj === "string") return obj;

  if (Array.isArray(obj)) {
    return obj.map(removeEmptyKeys).filter((v) => !isEmpty(v));
  }

  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "object" && value !== null) {
      const cleanedValue = removeEmptyKeys(value as Record<string, any>);
      if (!isEmpty(cleanedValue)) {
        result[key] = cleanedValue;
      }
    } else if (!isEmpty(value)) {
      result[key] = value;
    }
  }

  return Object.keys(result).length > 0 ? result : {};
};
