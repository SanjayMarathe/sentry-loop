"""Task and initial-data generation for SentinelOps Arena episodes."""

import random
from typing import List, Optional, Tuple

from sentinelops_arena.models import (
    Customer,
    CustomerTask,
    CustomerTier,
    Invoice,
    InvoiceStatus,
    TargetSystem,
    TaskType,
    Ticket,
    TicketPriority,
    TicketStatus,
)

# ---------------------------------------------------------------------------
# Message templates per task type
# ---------------------------------------------------------------------------

_TASK_CONFIGS = [
    (
        TaskType.REFUND,
        [TargetSystem.BILLING, TargetSystem.CRM],
        "I'd like a refund for invoice {inv_id}. Amount: ${amount:.2f}. Reason: not satisfied with service.",
    ),
    (
        TaskType.BALANCE_INQUIRY,
        [TargetSystem.BILLING],
        "Hi, can you tell me my current account balance? My customer ID is {cust_id}.",
    ),
    (
        TaskType.TICKET_CHECK,
        [TargetSystem.TICKETING],
        "What's the status of my support ticket {ticket_id}?",
    ),
    (
        TaskType.NEW_TICKET,
        [TargetSystem.TICKETING, TargetSystem.CRM],
        "I need help with {subject}. Please open a ticket for me.",
    ),
    (
        TaskType.TIER_UPGRADE,
        [TargetSystem.CRM, TargetSystem.BILLING],
        "I believe I qualify for a tier upgrade. My customer ID is {cust_id}. Can you check?",
    ),
    (
        TaskType.SLA_ESCALATION,
        [TargetSystem.TICKETING],
        "Ticket {ticket_id} is urgent and hasn't been addressed yet. Please escalate immediately.",
    ),
]

_NEW_TICKET_SUBJECTS = [
    "a billing discrepancy on my last invoice",
    "difficulty accessing my account dashboard",
    "slow response times from the API",
    "an incorrect charge on my statement",
    "missing features in my subscription plan",
    "data export not working properly",
    "integration issues with our CRM",
    "a security concern about my account",
]


def generate_tasks(
    customers: List[Customer],
    invoices: List[Invoice],
    tickets: List[Ticket],
    num_tasks: int = 30,
) -> List[CustomerTask]:
    """Generate a queue of customer tasks for one episode.

    Each task references real customer / invoice / ticket IDs from the
    provided data so the worker can look them up in the simulated systems.
    Tasks arrive one per tick (arrival_tick == task index).
    """
    tasks: List[CustomerTask] = []

    for i in range(num_tasks):
        task_type, systems, template = random.choice(_TASK_CONFIGS)
        customer = random.choice(customers)

        # Build template kwargs from available data
        kwargs: dict = {"cust_id": customer.customer_id}

        if task_type == TaskType.REFUND:
            # Pick a random invoice (preferring ones belonging to this customer)
            cust_invoices = [inv for inv in invoices if inv.customer_id == customer.customer_id]
            invoice = random.choice(cust_invoices) if cust_invoices else random.choice(invoices)
            kwargs["inv_id"] = invoice.invoice_id
            kwargs["amount"] = invoice.amount

        elif task_type in (TaskType.TICKET_CHECK, TaskType.SLA_ESCALATION):
            cust_tickets = [t for t in tickets if t.customer_id == customer.customer_id]
            ticket = random.choice(cust_tickets) if cust_tickets else random.choice(tickets)
            kwargs["ticket_id"] = ticket.ticket_id

        elif task_type == TaskType.NEW_TICKET:
            kwargs["subject"] = random.choice(_NEW_TICKET_SUBJECTS)

        message = template.format(**kwargs)

        tasks.append(
            CustomerTask(
                task_id=f"TASK-{i:03d}",
                customer_id=customer.customer_id,
                task_type=task_type,
                message=message,
                required_systems=systems,
                arrival_tick=i,
            )
        )

    return tasks


# ---------------------------------------------------------------------------
# Initial data generation for episode reset
# ---------------------------------------------------------------------------

_FIRST_NAMES = [
    "Alice", "Bob", "Carol", "David", "Eve", "Frank", "Grace", "Hank",
    "Ivy", "Jack", "Karen", "Leo", "Mona", "Nick", "Olivia", "Pat",
    "Quinn", "Rita", "Sam", "Tina",
]

_LAST_NAMES = [
    "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller",
    "Davis", "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez",
    "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin",
]

_REGIONS = ["us-east", "us-west", "eu-west", "eu-central", "ap-southeast"]

_INVOICE_ITEMS = [
    "Enterprise License", "API Credits", "Support Tier", "Data Storage",
    "Premium Add-on", "Training Session", "Consulting Hours", "Integration Fee",
]

_TICKET_SUBJECTS = [
    "Cannot access dashboard",
    "Billing discrepancy",
    "API rate limit exceeded",
    "Data export failure",
    "Account lockout",
    "Missing invoice",
    "Feature request",
    "Performance degradation",
    "Integration error",
    "Security alert",
]


def generate_initial_data(
    num_customers: int = 15,
    num_invoices: int = 15,
    num_tickets: int = 10,
    seed: Optional[int] = None,
) -> Tuple[List[Customer], List[Invoice], List[Ticket]]:
    """Generate random customers, invoices, and tickets for an episode reset."""
    rng = random.Random(seed)

    # --- Customers ---
    customers: List[Customer] = []
    for i in range(num_customers):
        first = rng.choice(_FIRST_NAMES)
        last = rng.choice(_LAST_NAMES)
        name = f"{first} {last}"
        tier = rng.choice(list(CustomerTier))
        region = rng.choice(_REGIONS)
        customers.append(
            Customer(
                customer_id=f"C{i:03d}",
                name=name,
                tier=tier,
                region=region,
                contact_email=f"{first.lower()}.{last.lower()}@example.com",
                lifetime_value=round(rng.uniform(500, 50000), 2),
            )
        )

    # --- Invoices ---
    invoices: List[Invoice] = []
    for i in range(num_invoices):
        cust = rng.choice(customers)
        num_items = rng.randint(1, 3)
        items = rng.sample(_INVOICE_ITEMS, min(num_items, len(_INVOICE_ITEMS)))
        invoices.append(
            Invoice(
                invoice_id=f"INV-{i:04d}",
                customer_id=cust.customer_id,
                amount=round(rng.uniform(50, 8000), 2),
                status=rng.choice(list(InvoiceStatus)),
                date_tick=rng.randint(0, 20),
                items=items,
            )
        )

    # --- Tickets ---
    sla_map = {TicketPriority.HIGH: 6, TicketPriority.MEDIUM: 12, TicketPriority.LOW: 18}
    tickets: List[Ticket] = []
    for i in range(num_tickets):
        cust = rng.choice(customers)
        priority = rng.choice(list(TicketPriority))
        created_tick = rng.randint(0, 10)
        tickets.append(
            Ticket(
                ticket_id=f"TK-{i:03d}",
                customer_id=cust.customer_id,
                subject=rng.choice(_TICKET_SUBJECTS),
                priority=priority,
                status=rng.choice(list(TicketStatus)),
                created_tick=created_tick,
                sla_deadline_tick=created_tick + sla_map[priority],
                data_region=cust.region,
            )
        )

    return customers, invoices, tickets
