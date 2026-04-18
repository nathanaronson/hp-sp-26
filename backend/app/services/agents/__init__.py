"""Deployment agents.

Two prompts, two tool sets, run sequentially:

    Agent #1 (analyze) → produces an install/start plan.
    Agent #2 (expose)  → executes the plan and finds the public port.

The actual agent loop (Anthropic Messages API + Dedalus exec dispatcher)
plugs in here. The prompts and tool schemas are the stable contract.
"""

from .prompts import (
    ANALYZE_SYSTEM,
    ANALYZE_USER_TEMPLATE,
    ENVIRONMENT,
    EXPOSE_SYSTEM,
    EXPOSE_USER_TEMPLATE,
    render_analyze_user,
    render_expose_user,
)
from .tools import (
    ANALYZE_TOOLS,
    EXPOSE_TOOLS,
    REPORT_FAILURE,
    REPORT_INSTALL_PLAN,
    REPORT_PORT,
)

__all__ = [
    "ANALYZE_SYSTEM",
    "ANALYZE_TOOLS",
    "ANALYZE_USER_TEMPLATE",
    "ENVIRONMENT",
    "EXPOSE_SYSTEM",
    "EXPOSE_TOOLS",
    "EXPOSE_USER_TEMPLATE",
    "REPORT_FAILURE",
    "REPORT_INSTALL_PLAN",
    "REPORT_PORT",
    "render_analyze_user",
    "render_expose_user",
]
