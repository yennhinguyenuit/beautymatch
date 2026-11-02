# Copyright (c) 2026, BeautyMatch Team and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import now_datetime


CONCERN_FIELDS = (
    "concern_oil_control",
    "concern_acne",
    "concern_post_acne",
    "concern_dehydration",
    "concern_barrier",
    "concern_dullness",
    "concern_aging",
)


class BeautyProfile(Document):
    def validate(self):
        self.validate_concerns()
        self.validate_budget()
        self.validate_consent()
        self.last_assessment = now_datetime()

    def validate_concerns(self):
        selected = sum(int(self.get(field) or 0) for field in CONCERN_FIELDS)

        if selected < 1:
            frappe.throw(_("Please select at least one skin concern."))

        if selected > 3:
            frappe.throw(_("You can select a maximum of 3 skin concerns."))

    def validate_budget(self):
        if self.max_budget is None or float(self.max_budget) <= 0:
            frappe.throw(_("Maximum budget must be greater than zero."))

    def validate_consent(self):
        if not self.consent:
            frappe.throw(_("Consent is required to store a Beauty Profile."))
