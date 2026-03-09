import os

from langfuse import Langfuse
from langfuse.openai import openai

from db import DB


def create_db() -> DB:
    return DB()


def create_langfuse() -> Langfuse:
    return Langfuse()


def create_openai_client() -> openai.OpenAI:
    return openai.OpenAI(base_url=os.getenv("OPENAI_BASE_URL"))
