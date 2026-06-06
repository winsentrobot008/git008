"""
ClawMode Integration — ClawAI economic tracking for nanobot.

Extends nanobot's AgentLoop with economic tools so every conversation
is cost-tracked and the agent can check its balance and survival status.
"""

from clawmode_integration.agent_loop import ClawAIAgentLoop
from clawmode_integration.task_classifier import TaskClassifier
from clawmode_integration.tools import (
    ClawAIState,
    DecideActivityTool,
    SubmitWorkTool,
    LearnTool,
    GetStatusTool,
)
from clawmode_integration.artifact_tools import CreateArtifactTool, ReadArtifactTool
from clawmode_integration.provider_wrapper import TrackedProvider

__all__ = [
    "ClawAIAgentLoop",
    "ClawAIState",
    "DecideActivityTool",
    "SubmitWorkTool",
    "LearnTool",
    "GetStatusTool",
    "CreateArtifactTool",
    "ReadArtifactTool",
    "TaskClassifier",
    "TrackedProvider",
]
