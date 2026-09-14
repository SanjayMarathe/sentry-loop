"""CRM system simulator for SentinelOps Arena."""

from typing import Dict, List

from sentinelops_arena.models import Customer, CustomerTier


class CRMSystem:
    def __init__(self):
        self.customers: Dict[str, Dict] = {}
        self._schema = set(Customer.model_fields.keys())
        self._field_map: Dict[str, str] = {}  # old_name -> new_name for drift

    def initialize(self, customers: List[Customer]):
        """Populate CRM from Customer models."""
        self.customers = {c.customer_id: c.model_dump() for c in customers}
        self._field_map = {}

    def lookup_customer(self, customer_id: str) -> Dict:
        """Return customer record with field mapping applied."""
        if customer_id not in self.customers:
            return {"error": f"Customer {customer_id} not found"}
        return {"success": True, **self._apply_field_map(self.customers[customer_id])}

    def update_tier(self, customer_id: str, new_tier: str) -> Dict:
        """Validate and apply tier change."""
        if customer_id not in self.customers:
            return {"error": f"Customer {customer_id} not found"}

        # Validate tier value
        try:
            tier = CustomerTier(new_tier)
        except ValueError:
            valid = [t.value for t in CustomerTier]
            return {"error": f"Invalid tier '{new_tier}'. Valid tiers: {valid}"}

        # Find the tier field (may have been renamed by drift)
        tier_field = self._field_map.get("tier", "tier")
        old_tier = self.customers[customer_id].get(tier_field, "unknown")
        self.customers[customer_id][tier_field] = tier.value
        return {
            "success": True,
            "customer_id": customer_id,
            "old_tier": old_tier,
            "new_tier": tier.value,
        }

    def add_note(self, customer_id: str, note: str) -> Dict:
        """Append a note to customer record."""
        if customer_id not in self.customers:
            return {"error": f"Customer {customer_id} not found"}

        notes_field = self._field_map.get("notes", "notes")
        if notes_field not in self.customers[customer_id]:
            self.customers[customer_id][notes_field] = []
        self.customers[customer_id][notes_field].append(note)
        return {
            "success": True,
            "customer_id": customer_id,
            "note_added": note,
            "total_notes": len(self.customers[customer_id][notes_field]),
        }

    def get_history(self, customer_id: str) -> Dict:
        """Return interaction history (notes) for a customer."""
        if customer_id not in self.customers:
            return {"error": f"Customer {customer_id} not found"}

        notes_field = self._field_map.get("notes", "notes")
        notes = self.customers[customer_id].get(notes_field, [])
        return {
            "success": True,
            "customer_id": customer_id,
            "notes": notes,
            "total_interactions": len(notes),
        }

    def get_schema(self) -> Dict:
        """Return current field names after any drift."""
        fields = list(Customer.model_fields.keys())
        for old, new in self._field_map.items():
            fields = [new if f == old else f for f in fields]
        return {"system": "crm", "fields": fields}

    def apply_schema_drift(self, old_field: str, new_field: str):
        """Rename a field across all records."""
        self._field_map[old_field] = new_field
        for cid in self.customers:
            if old_field in self.customers[cid]:
                self.customers[cid][new_field] = self.customers[cid].pop(old_field)

    def _apply_field_map(self, record: Dict) -> Dict:
        """Apply field renames to a record copy."""
        result = dict(record)
        for old, new in self._field_map.items():
            if old in result:
                result[new] = result.pop(old)
        return result
