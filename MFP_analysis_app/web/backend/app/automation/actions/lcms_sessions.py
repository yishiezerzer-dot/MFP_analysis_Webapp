"""LCMS session-level automation actions."""
from __future__ import annotations

import asyncio

from ...services.lcms_service import registry
from ..models import (
    EmptyInput,
    LCMSGetSessionStateOutput,
    LCMSListSessionsOutput,
    LCMSSessionIdInput,
)
from ..registry import ActionSpec, register
from .lcms_common import get_lcms_session, session_summary


@register(
    ActionSpec(
        id="lcms.list_sessions",
        summary="List loaded LCMS sessions.",
        input_model=EmptyInput,
        output_model=LCMSListSessionsOutput,
        risk="safe",
        scope="backend",
    )
)
async def list_sessions(_args: EmptyInput) -> LCMSListSessionsOutput:
    def work() -> LCMSListSessionsOutput:
        return LCMSListSessionsOutput(sessions=[session_summary(state) for state in registry.list()])

    return await asyncio.to_thread(work)


@register(
    ActionSpec(
        id="lcms.get_session_state",
        summary="Get LCMS session metadata and indexed MS1 scan state.",
        input_model=LCMSSessionIdInput,
        output_model=LCMSGetSessionStateOutput,
        risk="safe",
        scope="backend",
    )
)
async def get_session_state(args: LCMSSessionIdInput) -> LCMSGetSessionStateOutput:
    def work() -> LCMSGetSessionStateOutput:
        state = get_lcms_session(args.session_id)
        return LCMSGetSessionStateOutput(
            session=session_summary(state),
            ms1_meta=state.ms1_meta(),
        )

    return await asyncio.to_thread(work)
