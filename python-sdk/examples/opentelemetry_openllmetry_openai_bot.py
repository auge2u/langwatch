# This example uses the OpenTelemetry instrumentation for OpenAI from OpenLLMetry: https://pypi.org/project/opentelemetry-instrumentation-openai/

from dotenv import load_dotenv

load_dotenv()

import chainlit as cl

import os
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk import trace as trace_sdk
from opentelemetry.sdk.trace.export import ConsoleSpanExporter, SimpleSpanProcessor
from opentelemetry.instrumentation.openai import OpenAIInstrumentor
from openai import OpenAI
from traceloop.sdk import Traceloop


client = OpenAI()

import sys

sys.path.append("..")
import langwatch


# Set up OpenTelemetry trace provider with LangWatch as the endpoint
tracer_provider = trace_sdk.TracerProvider()
tracer_provider.add_span_processor(
    SimpleSpanProcessor(
        OTLPSpanExporter(
            endpoint=f"{langwatch.endpoint}/api/otel/v1/traces",
            headers={"Authorization": "Bearer " + os.environ["LANGWATCH_API_KEY"]},
        )
    )
)
# Optionally, you can also print the spans to the console.
tracer_provider.add_span_processor(SimpleSpanProcessor(ConsoleSpanExporter()))

OpenAIInstrumentor().instrument(tracer_provider=tracer_provider)

@cl.on_message
async def main(message: cl.Message):
    Traceloop.set_association_properties({ "user_id": "user12345", "chat_id": "chat12345" })
    msg = cl.Message(
        content="",
    )

    completion = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {
                "role": "system",
                "content": "You are a helpful assistant that only reply in short tweet-like responses, using lots of emojis.",
            },
            {"role": "user", "content": message.content},
        ],
        stream=True,
    )

    for part in completion:
        if token := part.choices[0].delta.content or "":
            await msg.stream_token(token)

    await msg.update()
