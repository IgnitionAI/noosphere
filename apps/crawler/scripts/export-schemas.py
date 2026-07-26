#!/usr/bin/env python3
"""
Export Pydantic models as JSON Schema files for cross-layer contract testing.
Exports both Python SDK models and crawler service models.
"""

import json
import os
import sys

def export_sdk_schemas(output_dir: str) -> None:
    """Export Python SDK Pydantic models as JSON Schema."""
    sdk_dir = os.path.join(os.path.dirname(__file__), "..", "..", "packages", "sdk-python", "src")
    sys.path.insert(0, sdk_dir)

    try:
        from ignitionai.types.shared import Source, ImageResult, PipelineMetrics, FilterDefinition, ChatMessage
        from ignitionai.types.chat import ChatParams, ChatResponse
        from ignitionai.types.agents import Agent, AgentCreateParams
        from ignitionai.types.collections import Collection, CollectionCreateParams

        models = {
            "Source": Source,
            "ImageResult": ImageResult,
            "PipelineMetrics": PipelineMetrics,
            "FilterDefinition": FilterDefinition,
            "ChatMessage": ChatMessage,
            "ChatParams": ChatParams,
            "ChatResponse": ChatResponse,
            "Agent": Agent,
            "AgentCreateParams": AgentCreateParams,
            "Collection": Collection,
            "CollectionCreateParams": CollectionCreateParams,
        }

        sdk_out = os.path.join(output_dir, "sdk-python")
        os.makedirs(sdk_out, exist_ok=True)

        for name, model in models.items():
            schema = model.model_json_schema(by_alias=True)
            with open(os.path.join(sdk_out, f"{name}.json"), "w") as f:
                json.dump(schema, f, indent=2)

        print(f"Exported {len(models)} SDK schemas to {sdk_out}")

    except ImportError as e:
        print(f"Warning: Could not import Python SDK models: {e}", file=sys.stderr)
        print("Skipping SDK schema export. Install SDK with: pip install -e packages/sdk-python", file=sys.stderr)


def export_crawler_schemas(output_dir: str) -> None:
    """Export crawler service Pydantic models as JSON Schema."""
    crawler_dir = os.path.join(os.path.dirname(__file__), "..", "src")
    sys.path.insert(0, crawler_dir)

    try:
        from crawler_service.api.schemas import (
            CrawlRequest, CrawlStartResponse, CrawlStatusResponse,
            DiscoverRequest, DiscoverResponse,
            CrawlPagesRequest, SearchRequest,
        )

        models = {
            "CrawlRequest": CrawlRequest,
            "CrawlStartResponse": CrawlStartResponse,
            "CrawlStatusResponse": CrawlStatusResponse,
            "DiscoverRequest": DiscoverRequest,
            "DiscoverResponse": DiscoverResponse,
            "CrawlPagesRequest": CrawlPagesRequest,
            "SearchRequest": SearchRequest,
        }

        crawler_out = os.path.join(output_dir, "crawler")
        os.makedirs(crawler_out, exist_ok=True)

        for name, model in models.items():
            schema = model.model_json_schema()
            with open(os.path.join(crawler_out, f"{name}.json"), "w") as f:
                json.dump(schema, f, indent=2)

        print(f"Exported {len(models)} crawler schemas to {crawler_out}")

    except ImportError as e:
        print(f"Warning: Could not import crawler models: {e}", file=sys.stderr)
        print("Skipping crawler schema export.", file=sys.stderr)


def main() -> None:
    output_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        os.path.dirname(__file__), "..", "..", "back", "tests", "contracts", ".schemas"
    )
    os.makedirs(output_dir, exist_ok=True)

    export_sdk_schemas(output_dir)
    export_crawler_schemas(output_dir)

    print(f"\nAll schemas exported to: {output_dir}")


if __name__ == "__main__":
    main()
