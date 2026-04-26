"""AI Assistant API.

Thin router that wraps :mod:`app.services.ai_service`. The service in turn
wraps the existing ``lab_gui.ai_assistant`` / ``lab_gui.ai_openai_client`` /
``lab_gui.ai_ollama_client`` modules, so the web build shares the same
system prompt, demo-mode fallback and response shape as the desktop app.
"""
from __future__ import annotations

from typing import List, Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..services import ai_service

router = APIRouter()


class ChatMessage(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str


class ChatRequest(BaseModel):
    messages: List[ChatMessage] = Field(..., min_length=1)
    provider: Literal["demo", "openai", "ollama"] = "demo"
    model: Optional[str] = None
    active_module: Optional[str] = None
    session_ids: List[str] = Field(default_factory=list)
    include_context: bool = True
    ollama_base_url: Optional[str] = None


@router.get("/status")
def status() -> dict:
    """Return which providers are available and the default model hint."""
    return ai_service.provider_status()


@router.get("/context")
def context() -> dict:
    """Return per-module session snapshots for the context picker."""
    return ai_service.context_snapshot()


@router.post("/chat")
def chat(body: ChatRequest) -> dict:
    """Run one chat turn. Returns the assistant response + mode + context."""
    try:
        return ai_service.run_chat(
            messages=[m.model_dump() for m in body.messages],
            provider=body.provider,
            model=body.model,
            active_module=body.active_module,
            session_ids=body.session_ids,
            include_context=body.include_context,
            ollama_base_url=body.ollama_base_url,
        )
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=500, detail=f"AI chat failed: {exc}") from exc
