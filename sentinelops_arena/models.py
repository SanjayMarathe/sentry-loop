from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field
from openenv.core.env_server.types import Action, Observation, State


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class AgentRole(str, Enum):
    ATTACKER = "attacker"
    WORKER = "worker"
    OVERSIGHT = "oversight"


class AttackType(str, Enum):
    SCHEMA_DRIFT = "schema_drift"
    POLICY_DRIFT = "policy_drift"
    SOCIAL_ENGINEERING = "social_engineering"
    RATE_LIMIT = "rate_limit"


class TargetSystem(str, Enum):
    CRM = "crm"
    BILLING = "billing"
    TICKETING = "ticketing"


class CustomerTier(str, Enum):
    GOLD = "gold"
    SILVER = "silver"
    BRONZE = "bronze"


class InvoiceStatus(str, Enum):
    PAID = "paid"
    PENDING = "pending"
    OVERDUE = "overdue"
    REFUNDED = "refunded"


class TicketStatus(str, Enum):
    OPEN = "open"
    IN_PROGRESS = "in_progress"
    RESOLVED = "resolved"
    ESCALATED = "escalated"


class TicketPriority(str, Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class TaskType(str, Enum):
    REFUND = "refund"
    TICKET_CHECK = "ticket_check"
    TIER_UPGRADE = "tier_upgrade"
    NEW_TICKET = "new_ticket"
    BALANCE_INQUIRY = "balance_inquiry"
    SLA_ESCALATION = "sla_escalation"


class ViolationType(str, Enum):
    POLICY_VIOLATION = "policy_violation"
    SOCIAL_ENGINEERING = "social_engineering"
    SCHEMA_ERROR_UNHANDLED = "schema_error_unhandled"
    SLA_BREACH = "sla_breach"


# ---------------------------------------------------------------------------
# Data Models
# ---------------------------------------------------------------------------

class Customer(BaseModel):
    customer_id: str
    name: str
    tier: CustomerTier
    region: str
    contact_email: str
    lifetime_value: float
    notes: List[str] = Field(default_factory=list)


class Invoice(BaseModel):
    invoice_id: str
    customer_id: str
    amount: float
    status: InvoiceStatus
    date_tick: int
    items: List[str]


class Ticket(BaseModel):
    ticket_id: str
    customer_id: str
    subject: str
    priority: TicketPriority
    status: TicketStatus
    created_tick: int
    sla_deadline_tick: int
    assigned_to: Optional[str] = None
    data_region: str = "us-east"


class RefundPolicy(BaseModel):
    window_ticks: int = 8
    requires_approval: bool = False
    max_amount: float = 5000.0


class SLARules(BaseModel):
    high: int = 6
    medium: int = 12
    low: int = 18


class CustomerTask(BaseModel):
    task_id: str
    customer_id: str
    task_type: TaskType
    message: str
    required_systems: List[TargetSystem]
    arrival_tick: int


# ---------------------------------------------------------------------------
# OpenEnv Types
# ---------------------------------------------------------------------------

class SentinelAction(Action):
    """Action for all three agent roles.

    Action base has extra='forbid', so every agent-specific field must be
    Optional with a default so that agents only populate the subset they use.
    """
    agent: AgentRole
    action_type: str
    target_system: Optional[TargetSystem] = None
    parameters: Dict[str, Any] = Field(default_factory=dict)
    response_text: Optional[str] = None
    flag: Optional[bool] = None
    explanation: Optional[str] = None


class SentinelObservation(Observation):
    """Observation returned to each agent on its turn.

    Observation base already provides done, reward, and metadata.
    """
    current_agent: AgentRole
    current_task: Optional[Dict[str, Any]] = None
    systems_snapshot: Dict[str, Any] = Field(default_factory=dict)
    last_action_result: Optional[Dict[str, Any]] = None
    trajectory: List[Dict[str, Any]] = Field(default_factory=list)
    tick: int = 0


class SentinelState(State):
    """Internal environment state.

    State base has extra='allow', episode_id, and step_count built-in.
    """
    tick: int = 0
    scores: Dict[str, float] = Field(default_factory=dict)
    active_attacks: List[Dict[str, Any]] = Field(default_factory=list)
    tasks_completed: int = 0
    tasks_total: int = 0


class TickGroundTruth(BaseModel):
    """Per-tick ground truth for oversight scoring."""
    violations_present: bool = False
    violation_types: List[ViolationType] = Field(default_factory=list)
    correct_action: Optional[str] = None
    is_social_engineering: bool = False
