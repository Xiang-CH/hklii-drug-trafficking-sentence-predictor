import os
import traceback
from dotenv import load_dotenv
from langchain.agents import create_agent
from langchain.agents.middleware import AgentMiddleware
from typing import Annotated, Any, TypedDict

from langchain.messages import AIMessage, AIMessageChunk, ToolMessage
from langchain_openai import ChatOpenAI
from langgraph.errors import GraphBubbleUp
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langchain_mongodb.agent_toolkit import (
    MongoDBDatabase,
    MongoDBDatabaseToolkit,
)
from langgraph.graph.ui import AnyUIMessage, ui_message_reducer, push_ui_message
from src.prompt import MONGODB_AGENT_SYSTEM_PROMPT
import re
import uuid

load_dotenv()

MONGODB_URI = os.getenv('DB_MONGODB_URI')
DB_NAME = os.getenv('DB_NAME')
TABLE_NAME = "llm-extracted-features"

BASE_URL = os.getenv('OPENAI_BASE_URL')
API_KEY = os.getenv('OPENAI_API_KEY')
MODEL = os.getenv('MODEL')

NATURAL_LANGUAGE_QUERY = "Find the number of cases for cocaine trafficking each year in the last 5 years"

_TOOL_ERROR_TRACE_LIMIT = 8000


def _build_tool_error_message(request, error):
    tb = traceback.format_exc()
    if len(tb) > _TOOL_ERROR_TRACE_LIMIT:
        tb = tb[:_TOOL_ERROR_TRACE_LIMIT] + f"\n... (traceback truncated, total {len(tb)} chars)"
    body = (
        "Tool invocation failed. Use this error to fix arguments or strategy and retry.\n\n"
        f"{type(error).__name__}: {error}\n\n{tb}"
    )
    return ToolMessage(
        content=body,
        tool_call_id=request.tool_call["id"],
        status="error",
    )


class ToolErrorMiddleware(AgentMiddleware):
    """Return tool errors as ToolMessage content for sync and async tool runs."""

    def wrap_tool_call(self, request, handler):
        try:
            return handler(request)
        except GraphBubbleUp:
            raise
        except Exception as error:
            return _build_tool_error_message(request, error)

    async def awrap_tool_call(self, request, handler):
        try:
            return await handler(request)
        except GraphBubbleUp:
            raise
        except Exception as error:
            return _build_tool_error_message(request, error)


def _coerce_message_content(content):
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                parts.append(item.get("text", ""))
            else:
                parts.append(str(item))
        return "".join(parts)
    if content is None:
        return ""
    return str(content)


def _normalize_message(message):
    if isinstance(message, dict):
        if "role" in message and "content" in message:
            return message
        if message.get("lc") == 1 and "kwargs" in message:
            message_id = message.get("id")
            message_type = message_id[-1] if isinstance(message_id, list) and message_id else None
            role = {
                "HumanMessage": "user",
                "AIMessage": "assistant",
                "SystemMessage": "system",
                "ToolMessage": "tool",
            }.get(message_type, "user")
            kwargs = message.get("kwargs", {})
            normalized = {
                "role": role,
                "content": _coerce_message_content(kwargs.get("content")),
            }
            if role == "tool":
                tool_call_id = kwargs.get("tool_call_id")
                if tool_call_id:
                    normalized["tool_call_id"] = tool_call_id
            return normalized
    return message


def _normalize_input(payload):
    if not isinstance(payload, dict) or "messages" not in payload:
        return payload
    messages = payload.get("messages")
    if messages is None:
        return payload
    normalized = []
    for message in messages:
        if isinstance(message, tuple) and len(message) == 2:
            role, content = message
            normalized.append({"role": role, "content": content})
        else:
            normalized.append(_normalize_message(message))
    return {**payload, "messages": normalized}


class AgentState(TypedDict):
    messages: Annotated[list[Any], add_messages]
    ui: Annotated[list[AnyUIMessage], ui_message_reducer]


def _build_llm() -> ChatOpenAI:
    return ChatOpenAI(
        model=MODEL,
        timeout=60,
        base_url=BASE_URL,
        api_key=API_KEY,
    )


def _build_toolkit(llm: ChatOpenAI) -> MongoDBDatabaseToolkit:
    db_wrapper = MongoDBDatabase.from_connection_string(
        MONGODB_URI,
        database=DB_NAME,
    )
    return MongoDBDatabaseToolkit(db=db_wrapper, llm=llm)

def extract_html_code_block(text: str) -> str | None:
    pattern = r"```(?:html)?\s*([\s\S]*?)```"
    match = re.search(pattern, text, re.IGNORECASE)
    if not match:
        return None
    return match.group(1).strip()

def build_agent():
    llm = _build_llm()
    toolkit = _build_toolkit(llm)
    system_message = MONGODB_AGENT_SYSTEM_PROMPT.format(
        table_name=TABLE_NAME,
    )
    agent_core = create_agent(
        llm,
        toolkit.get_tools(),
        system_prompt=system_message,
        middleware=[ToolErrorMiddleware()],
    )
    graph = StateGraph(AgentState)

    def normalize_node(state: AgentState):
        normalized = _normalize_input({"messages": state.get("messages", [])})
        return {"messages": normalized.get("messages", [])}
    
    def output_separate(state: AgentState):
        messages = state.get("messages", [])
        if not messages:
            return {}
        
        response = messages[-1].content
        if not response:
            return {}
        
        embedded_html = extract_html_code_block(response)
        if not embedded_html:
            return {}

        return_message = AIMessage(
            id=messages[-1].id,
            content="I generated an HTML preview. Click the card to open it.",
        )

        push_ui_message(
            "html_preview",
            props={
                "title": "Data Visualization Artifacts",
                "description": "Online live HTML preview",
                "html": embedded_html,
            },
            message=return_message,
        )

        return {
            "messages": [return_message],
        }

    graph.add_node("normalize", normalize_node)
    graph.add_node("agent", agent_core)
    graph.add_node("post_extract", output_separate)
    graph.add_edge(START, "normalize")
    graph.add_edge("normalize", "agent")
    graph.add_edge("agent", "post_extract")
    graph.add_edge("post_extract", END)
    return graph.compile()


agent = build_agent()


def stream_query(query: str, *, verbose: bool = True):
    messages = []
    for chunk in agent.stream(
        {"messages": [("user", query)]},
        stream_mode=["messages", "updates", "values"],
        version="v2",
    ):
        if not verbose:
            if chunk["type"] == "values" and isinstance(chunk["data"], dict):
                msgs = chunk["data"].get("messages")
                if msgs is not None:
                    messages = list(msgs)
            continue

        if chunk["type"] == "messages":
            token, _metadata = chunk["data"]
            if isinstance(token, AIMessageChunk) and token.text:
                print(token.text, end="", flush=True)
        elif chunk["type"] == "updates":
            for source, update in chunk["data"].items():
                if source == "__interrupt__":
                    print(f"\n[interrupt] {update}")
                    continue
                update_messages = update.get("messages") if isinstance(update, dict) else None
                if not update_messages:
                    continue
                msg = update_messages[-1]
                if isinstance(msg, AIMessage) and msg.tool_calls:
                    print(f"\n[tool calls] {msg.tool_calls}", flush=True)
                if isinstance(msg, ToolMessage):
                    body = msg.content if isinstance(msg.content, str) else str(msg.content)
                    preview = body[:2000]
                    suffix = "…" if len(body) > 2000 else ""
                    print(f"\n[tool result] {preview}{suffix}", flush=True)
        elif chunk["type"] == "values" and isinstance(chunk["data"], dict):
            msgs = chunk["data"].get("messages")
            if msgs is not None:
                messages = list(msgs)

    if verbose:
        print()

    return messages


def run_query(query: str, *, verbose: bool = True):
    messages = stream_query(query, verbose=verbose)
    if not messages:
        return None
    return messages[-1].content


if __name__ == "__main__":
    results = run_query(NATURAL_LANGUAGE_QUERY)
    print(results)