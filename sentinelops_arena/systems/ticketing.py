"""Ticketing system simulator for SentinelOps Arena."""

import uuid
from typing import Dict, List

from sentinelops_arena.models import (
    SLARules,
    Ticket,
    TicketPriority,
    TicketStatus,
)


class TicketingSystem:
    def __init__(self):
        self.tickets: Dict[str, Dict] = {}
        self.sla_rules: SLARules = SLARules()
        self._field_map: Dict[str, str] = {}  # old_name -> new_name for drift

    def initialize(self, tickets: List[Ticket]):
        """Populate ticketing system from Ticket models."""
        self.tickets = {t.ticket_id: t.model_dump() for t in tickets}
        self.sla_rules = SLARules()
        self._field_map = {}

    def create_ticket(
        self, customer_id: str, subject: str, priority: str, current_tick: int
    ) -> Dict:
        """Create a new ticket and assign SLA deadline based on priority."""
        try:
            prio = TicketPriority(priority)
        except ValueError:
            valid = [p.value for p in TicketPriority]
            return {"error": f"Invalid priority '{priority}'. Valid: {valid}"}

        # Calculate SLA deadline from rules
        sla_ticks = getattr(self.sla_rules, prio.value)
        deadline = current_tick + sla_ticks

        ticket_id = f"TKT-{uuid.uuid4().hex[:8].upper()}"
        ticket_data = {
            "ticket_id": ticket_id,
            "customer_id": customer_id,
            "subject": subject,
            "priority": prio.value,
            "status": TicketStatus.OPEN.value,
            "created_tick": current_tick,
            "sla_deadline_tick": deadline,
            "assigned_to": None,
            "data_region": "us-east",
        }
        self.tickets[ticket_id] = ticket_data
        return {
            "success": True,
            "ticket_id": ticket_id,
            "sla_deadline_tick": deadline,
            "priority": prio.value,
        }

    def assign_ticket(self, ticket_id: str, agent_name: str) -> Dict:
        """Assign a ticket to an agent."""
        if ticket_id not in self.tickets:
            return {"error": f"Ticket {ticket_id} not found"}

        ticket = self.tickets[ticket_id]
        status_field = self._field_map.get("status", "status")
        assigned_field = self._field_map.get("assigned_to", "assigned_to")

        ticket[status_field] = TicketStatus.IN_PROGRESS.value
        ticket[assigned_field] = agent_name
        return {
            "success": True,
            "ticket_id": ticket_id,
            "assigned_to": agent_name,
            "status": TicketStatus.IN_PROGRESS.value,
        }

    def escalate(self, ticket_id: str, reason: str) -> Dict:
        """Escalate a ticket."""
        if ticket_id not in self.tickets:
            return {"error": f"Ticket {ticket_id} not found"}

        ticket = self.tickets[ticket_id]
        status_field = self._field_map.get("status", "status")
        ticket[status_field] = TicketStatus.ESCALATED.value
        return {
            "success": True,
            "ticket_id": ticket_id,
            "status": TicketStatus.ESCALATED.value,
            "reason": reason,
        }

    def resolve(self, ticket_id: str, resolution: str) -> Dict:
        """Resolve a ticket."""
        if ticket_id not in self.tickets:
            return {"error": f"Ticket {ticket_id} not found"}

        ticket = self.tickets[ticket_id]
        status_field = self._field_map.get("status", "status")
        ticket[status_field] = TicketStatus.RESOLVED.value
        return {
            "success": True,
            "ticket_id": ticket_id,
            "status": TicketStatus.RESOLVED.value,
            "resolution": resolution,
        }

    def check_sla(self, ticket_id: str, current_tick: int) -> Dict:
        """Return ticks remaining before SLA breach."""
        if ticket_id not in self.tickets:
            return {"error": f"Ticket {ticket_id} not found"}

        ticket = self.tickets[ticket_id]
        deadline_field = self._field_map.get("sla_deadline_tick", "sla_deadline_tick")
        deadline = ticket.get(deadline_field, 0)
        remaining = deadline - current_tick
        return {
            "success": True,
            "ticket_id": ticket_id,
            "sla_deadline_tick": deadline,
            "current_tick": current_tick,
            "ticks_remaining": remaining,
            "breached": remaining < 0,
        }

    def get_schema(self) -> Dict:
        """Return current field names after any drift."""
        fields = list(Ticket.model_fields.keys())
        for old, new in self._field_map.items():
            fields = [new if f == old else f for f in fields]
        return {"system": "ticketing", "fields": fields}

    def get_sla_rules(self) -> Dict:
        """Return current SLA rules."""
        return {
            "success": True,
            "sla_rules": self.sla_rules.model_dump(),
        }

    def apply_policy_drift(self, changes: Dict):
        """Modify SLA rules fields (mirrors billing policy drift)."""
        data = self.sla_rules.model_dump()
        data.update(changes)
        self.sla_rules = SLARules(**data)

    def apply_schema_drift(self, old_field: str, new_field: str):
        """Rename a field across all records."""
        self._field_map[old_field] = new_field
        for tid in self.tickets:
            if old_field in self.tickets[tid]:
                self.tickets[tid][new_field] = self.tickets[tid].pop(old_field)
