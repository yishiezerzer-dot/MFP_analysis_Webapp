"""AI Assistant service.

Wraps the existing `lab_gui.ai_assistant` / `ai_openai_client` /
`ai_ollama_client` modules so the web app shares the same prompt,
system message, and mock-mode behaviour as the desktop app.

Providers
---------
- "demo"   : no network; returns the canned demo response (always works).
- "openai" : uses `openai` SDK if installed and `OPENAI_API_KEY` is set.
- "ollama" : uses local Ollama server at `OLLAMA_BASE_URL` (default http://127.0.0.1:11434).

Context
-------
Unlike the desktop build, the web backend assembles "active module"
summaries directly from the LCMS / FTIR / Plate Reader / Data Studio
registries that power the other tabs. The shape mirrors what
`lab_gui.ai_context.AppAIContext.to_prompt_dict` produces, so the
unchanged `AIAssistant._build_user_prompt` can consume it.
"""
from __future__ import annotations

import os
from dataclasses import asdict
from typing import Any, Dict, List, Optional

from lab_gui.ai_assistant import AIAssistant, AIAssistantResponse, SYSTEM_PROMPT
from lab_gui.ai_ollama_client import OllamaChatClient
from lab_gui.ai_openai_client import OpenAIChatClient

from .data_studio_service import registry as ds_registry
from .ftir_service import registry as ftir_registry
from .lcms_service import registry as lcms_registry
from .plate_reader_service import registry as plate_registry


# ------------------------------ providers ------------------------------


DEFAULT_MODELS = {
    "openai": "gpt-4.1-mini",
    "ollama": "llama3.1:8b",
    "demo": "demo",
}


def provider_status() -> Dict[str, Any]:
    """Inspect the environment and report which providers look usable.

    Returns a dict like::
        {
            "openai": {"available": True, "sdk": True, "env_var": "OPENAI_API_KEY"},
            "ollama": {"available": None, "base_url": "http://127.0.0.1:11434"},
            "demo":   {"available": True},
            "default": "openai",
        }

    ``ollama.available`` is ``None`` because we don't probe the network on
    status; the UI can show it as "try it" and surface failures on first use.
    """
    has_openai_sdk = True
    try:
        import openai  # noqa: F401
    except Exception:
        has_openai_sdk = False

    openai_key = bool(str(os.environ.get("OPENAI_API_KEY", "") or "").strip())

    default: str
    if has_openai_sdk and openai_key:
        default = "openai"
    else:
        default = "demo"

    return {
        "openai": {
            "available": bool(has_openai_sdk and openai_key),
            "sdk": has_openai_sdk,
            "api_key_env_var": "OPENAI_API_KEY",
            "has_api_key": openai_key,
            "default_model": DEFAULT_MODELS["openai"],
        },
        "ollama": {
            "available": None,
            "base_url": os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434"),
            "default_model": DEFAULT_MODELS["ollama"],
        },
        "demo": {"available": True},
        "default": default,
        "system_prompt": SYSTEM_PROMPT,
    }


def build_assistant(
    *,
    provider: str,
    model: Optional[str] = None,
    timeout_seconds: float = 30.0,
    ollama_base_url: Optional[str] = None,
) -> AIAssistant:
    prov = (provider or "").strip().lower()
    chosen_model = str(model or DEFAULT_MODELS.get(prov, "gpt-4.1-mini"))

    if prov == "openai":
        return AIAssistant(
            llm_client=OpenAIChatClient(api_key_env_var="OPENAI_API_KEY"),
            model=chosen_model,
            timeout_seconds=timeout_seconds,
        )
    if prov == "ollama":
        return AIAssistant(
            llm_client=OllamaChatClient(base_url=ollama_base_url),
            model=chosen_model,
            timeout_seconds=timeout_seconds,
        )
    # demo / unknown → no LLM client; AIAssistant returns the canned demo reply.
    return AIAssistant(llm_client=None, model=chosen_model, timeout_seconds=timeout_seconds)


# ------------------------------ context ------------------------------


def context_snapshot() -> Dict[str, Any]:
    """Per-module snapshots of what's loaded in the web backend.

    Safe to call at any time; never includes raw arrays/dataframes.
    """
    return {
        "LCMS": _snapshot_lcms(),
        "FTIR": _snapshot_ftir(),
        "Plate Reader": _snapshot_plate(),
        "Data Studio": _snapshot_ds(),
    }


def build_context_dict(
    *,
    active_module: Optional[str],
    session_ids: List[str],
) -> Dict[str, Any]:
    """Return the prompt-ready context dict consumed by `AIAssistant.ask`.

    The active module drives the summary copy; `session_ids` narrows the
    loaded_filenames list to the sessions the user explicitly picked (or
    all of them across modules if none specified).
    """
    snap = context_snapshot()
    mod = (active_module or "").strip()
    if mod not in snap:
        mod = _guess_active_module(snap)

    files: List[str] = []
    for name, info in snap.items():
        for sess in info.get("sessions", []):
            if not session_ids or sess["session_id"] in session_ids:
                if name == mod or not session_ids:
                    files.append(sess["display_name"])
        # prefer filenames of the active module only if picks target it
        if session_ids and name == mod:
            break

    # Always fall back to ALL filenames if the above left us empty.
    if not files:
        for info in snap.values():
            for sess in info.get("sessions", []):
                files.append(sess["display_name"])

    summary = snap.get(mod, {}).get("summary", "No module-specific summary available.")
    return {
        "active_module": mod or "General",
        "loaded_filenames": files[:16],
        "module_summary": summary,
    }


def _guess_active_module(snap: Dict[str, Any]) -> str:
    # Pick the first module that has any session loaded.
    for name, info in snap.items():
        if info.get("sessions"):
            return name
    return "General"


def _snapshot_lcms() -> Dict[str, Any]:
    sessions: List[Dict[str, Any]] = []
    for s in lcms_registry.list():
        sessions.append({"session_id": s.session_id, "display_name": s.display_name})
    if not sessions:
        summary = "LCMS module is available; no mzML sessions loaded."
    else:
        summary = f"LCMS has {len(sessions)} session(s) loaded."
    return {"sessions": sessions, "summary": summary}


def _snapshot_ftir() -> Dict[str, Any]:
    sessions: List[Dict[str, Any]] = []
    for s in ftir_registry.list():
        sessions.append({"session_id": s.session_id, "display_name": s.display_name})
    if not sessions:
        summary = "FTIR module is available; no spectra loaded."
    else:
        summary = f"FTIR has {len(sessions)} spectrum session(s) loaded."
    return {"sessions": sessions, "summary": summary}


def _snapshot_plate() -> Dict[str, Any]:
    sessions: List[Dict[str, Any]] = []
    for s in plate_registry.list():
        sessions.append({"session_id": s.session_id, "display_name": s.display_name})
    if not sessions:
        summary = "Plate Reader module is available; no plates loaded."
    else:
        summary = f"Plate Reader has {len(sessions)} plate session(s) loaded."
    return {"sessions": sessions, "summary": summary}


def _snapshot_ds() -> Dict[str, Any]:
    sessions: List[Dict[str, Any]] = []
    for s in ds_registry.list():
        sessions.append({"session_id": s.session_id, "display_name": s.display_name})
    if not sessions:
        summary = "Data Studio is available; no tables loaded."
    else:
        summary = f"Data Studio has {len(sessions)} table session(s) loaded."
    return {"sessions": sessions, "summary": summary}


# ------------------------------ chat ------------------------------


def run_chat(
    *,
    messages: List[Dict[str, str]],
    provider: str,
    model: Optional[str],
    active_module: Optional[str],
    session_ids: List[str],
    include_context: bool,
    ollama_base_url: Optional[str] = None,
) -> Dict[str, Any]:
    """Run one turn. Returns the AIAssistantResponse as a dict, plus echo of
    the context that was actually used (for transparency in the UI).
    """
    assistant = build_assistant(
        provider=provider,
        model=model,
        ollama_base_url=ollama_base_url,
    )

    # The last user message is treated as the current question. Previous
    # assistant turns are included in prompt context so the model sees a
    # short history (we prepend them before the newly-formatted turn).
    user_last = ""
    history_msgs: List[Dict[str, str]] = []
    for m in messages or []:
        role = str(m.get("role") or "user").strip().lower()
        content = str(m.get("content") or "")
        if role not in ("user", "assistant", "system"):
            continue
        if role == "user":
            user_last = content
            history_msgs.append({"role": "user", "content": content})
        else:
            history_msgs.append({"role": role, "content": content})

    ctx = (
        build_context_dict(active_module=active_module, session_ids=list(session_ids or []))
        if include_context
        else None
    )

    # Delegate to the shared assistant for single-turn work. For multi-turn
    # we manually call the client with the full history if a client is
    # available; otherwise the demo path covers single-turn only.
    if assistant._llm_client is None or len(history_msgs) <= 1:  # type: ignore[attr-defined]
        resp: AIAssistantResponse = assistant.ask(
            user_last, context=ctx, include_context=bool(include_context)
        )
    else:
        # Multi-turn path: keep the shared SYSTEM_PROMPT, fold the context
        # into a system preamble so the model sees it explicitly, then
        # replay the user/assistant turns verbatim.
        sys_msgs: List[Dict[str, str]] = [{"role": "system", "content": SYSTEM_PROMPT}]
        if ctx:
            sys_msgs.append(
                {
                    "role": "system",
                    "content": (
                        "Read-only app context:\n"
                        f"- active_module: {ctx.get('active_module', '')}\n"
                        f"- module_summary: {ctx.get('module_summary', '')}\n"
                        f"- loaded_filenames: {', '.join(ctx.get('loaded_filenames', []))}"
                    ),
                }
            )
        final_messages = sys_msgs + history_msgs
        try:
            text = str(
                assistant._llm_client.generate_reply(  # type: ignore[attr-defined]
                    final_messages,
                    model=assistant._model,  # type: ignore[attr-defined]
                    timeout_seconds=assistant._timeout_seconds,  # type: ignore[attr-defined]
                )
            ).strip()
            resp = AIAssistantResponse(
                text=text or "(empty response)",
                is_mock=False,
                used_context=bool(ctx),
                model=assistant._model,  # type: ignore[attr-defined]
            )
        except Exception as exc:  # fall back to the canned demo reply
            resp = assistant.ask(
                user_last, context=ctx, include_context=bool(include_context)
            )
            resp.error = str(exc)

    return {
        "response": asdict(resp),
        "mode_hint": assistant.mode_hint(),
        "used_context": ctx if include_context else None,
    }
