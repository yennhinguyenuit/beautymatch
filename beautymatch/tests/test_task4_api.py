"""Automated regression tests for BeautyMatch TASK 4."""

import json
from unittest.mock import patch
from uuid import uuid4

import frappe
from frappe.tests.utils import FrappeTestCase

from beautymatch.api.recommendation import (
    PROFILE_CHANGED,
    generate_recommendations,
)


class TestTask4GenerateAPI(FrappeTestCase):
    """Test recommendation generation without changing shared catalog data."""

    def setUp(self):
        super().setUp()

        self.crm_lead = "CRM-LEAD-2026-00002"
        self.beauty_profile = "icqe0sh0e2"

        self.assertTrue(
            frappe.db.exists("CRM Lead", self.crm_lead),
            "Thiếu CRM Lead fixture.",
        )
        self.assertTrue(
            frappe.db.exists("Beauty Profile", self.beauty_profile),
            "Thiếu Beauty Profile fixture.",
        )

        self.profile_version = str(
            frappe.db.get_value(
                "Beauty Profile",
                self.beauty_profile,
                "modified",
            )
        )

        self.request_id = str(uuid4())

        frappe.get_doc({
            "doctype": "Consultation Submission",
            "request_id": self.request_id,
            "payload_hash": "task4-test-" + self.request_id,
            "crm_lead": self.crm_lead,
            "beauty_profile": self.beauty_profile,
            "profile_version": self.profile_version,
            "response_json": json.dumps({"test": True}),
        }).insert(ignore_permissions=True)

        self.role_patch = patch(
            "beautymatch.api.recommendation._check_consultation_role"
        )
        self.lead_patch = patch(
            "beautymatch.api.recommendation._check_lead_access"
        )

        self.role_patch.start()
        self.lead_patch.start()

        self.addCleanup(self.role_patch.stop)
        self.addCleanup(self.lead_patch.stop)

    def _generate(self, profile_version=None):
        return generate_recommendations(
            crm_lead=self.crm_lead,
            beauty_profile=self.beauty_profile,
            request_id=self.request_id,
            profile_version=profile_version or self.profile_version,
        )

    @patch("beautymatch.api.recommendation.match_products")
    def test_generate_idempotency(self, mock_match):
        mock_match.return_value = {
            "results": [],
            "number_of_eligible_products": 0,
        }

        first = self._generate()
        second = self._generate()

        self.assertEqual(first["session_id"], second["session_id"])
        self.assertEqual(
            frappe.db.count(
                "Recommendation Session",
                {"request_id": self.request_id},
            ),
            1,
        )
        mock_match.assert_called_once()

    @patch("beautymatch.api.recommendation.match_products")
    def test_generate_without_matching_products(self, mock_match):
        mock_match.return_value = {
            "results": [],
            "number_of_eligible_products": 0,
        }

        result = self._generate()

        self.assertEqual(result["results"], [])
        self.assertEqual(result["number_of_recommendations"], 0)
        self.assertEqual(result["number_of_eligible_products"], 0)
        self.assertTrue(
            frappe.db.exists(
                "Recommendation Session",
                result["session_id"],
            )
        )

    @patch("beautymatch.api.recommendation.match_products")
    def test_profile_changed(self, mock_match):
        with self.assertRaises(PROFILE_CHANGED):
            self._generate(profile_version="2000-01-01 00:00:00")

        self.assertEqual(
            frappe.db.count(
                "Recommendation Session",
                {"request_id": self.request_id},
            ),
            0,
        )
        mock_match.assert_not_called()


from beautymatch.api.feedback import submit_feedback


class TestTask4FeedbackAPI(FrappeTestCase):
    """Regression tests for feedback and CRM Task lifecycle."""

    def setUp(self):
        super().setUp()

        self.crm_lead = "CRM-LEAD-2026-00002"
        self.beauty_profile = "icqe0sh0e2"

        product = frappe.db.get_value(
            "Product Profile",
            {"status": "Active"},
            "name",
        )
        self.assertTrue(product, "Thiếu Product Profile fixture.")

        assignee = frappe.db.get_value(
            "User",
            {"enabled": 1, "name": "beautymatch.sales.test@example.com"},
            "name",
        )
        self.assertTrue(assignee, "Thiếu user assignee fixture.")

        self.session = frappe.get_doc({
            "doctype": "Recommendation Session",
            "crm_lead": self.crm_lead,
            "beauty_profile": self.beauty_profile,
            "request_id": str(uuid4()),
            "profile_snapshot": json.dumps({"skin_type": "OILY"}),
            "requested_category": "CLEANSER",
            "max_budget": 500000,
            "number_of_eligible_products": 1,
            "number_of_recommendations": 1,
            "status": "Generated",
            "algorithm_version": "v1.0",
            "settings_snapshot": json.dumps({}),
            "result_message": "Test recommendation",
        })

        self.session.append("recommendation_items", {
            "rank": 1,
            "product": product,
            "product_code_snapshot": "TEST-PRODUCT",
            "product_name_snapshot": "Test Product",
            "brand_snapshot": "Test Brand",
            "price_snapshot": 100000,
            "final_match_score": 90,
            "skin_score": 30,
            "concern_score": 20,
            "ingredient_score": 15,
            "sensitivity_score": 10,
            "budget_score": 10,
            "brand_score": 5,
            "concern_coverage": 100,
            "why_recommended": "Test recommendation",
            "customer_feedback": "Interested",
        })

        self.session.insert(ignore_permissions=True)
        self.item_id = self.session.recommendation_items[0].name
        self.follow_up_key = f"{self.session.name}:{self.item_id}"

        self.settings = frappe.get_single("BeautyMatch Settings")
        self.settings.default_follow_up_assignee = assignee
        self.settings.default_follow_up_due_days = 1
        self.settings.save(ignore_permissions=True)

        self.role_patch = patch(
            "beautymatch.api.feedback._check_consultation_role"
        )
        self.lead_patch = patch(
            "beautymatch.api.feedback._check_lead_access"
        )
        self.permission_patch = patch(
            "beautymatch.api.feedback.frappe.has_permission",
            return_value=True,
        )

        self.role_patch.start()
        self.lead_patch.start()
        self.permission_patch.start()

        self.addCleanup(self.role_patch.stop)
        self.addCleanup(self.lead_patch.stop)
        self.addCleanup(self.permission_patch.stop)

    def _feedback(self, choice, reason=None):
        return submit_feedback(
            session_id=self.session.name,
            item_id=self.item_id,
            customer_feedback=choice,
            rejection_reason=reason,
        )

    def _task_count(self):
        return frappe.db.count(
            "CRM Task",
            {"beautymatch_follow_up_key": self.follow_up_key},
        )

    def test_interested_creates_only_one_task_on_repeated_click(self):
        first = self._feedback("Interested")
        second = self._feedback("Interested")

        self.assertEqual(first["follow_up_status"], "CREATED")
        self.assertEqual(second["follow_up_status"], "CREATED")
        self.assertEqual(first["follow_up_task"], second["follow_up_task"])
        self.assertEqual(self._task_count(), 1)

        task = frappe.get_doc("CRM Task", first["follow_up_task"])
        self.assertEqual(task.status, "Todo")

    def test_interested_to_not_interested_cancels_existing_task(self):
        created = self._feedback("Interested")
        task_name = created["follow_up_task"]

        result = self._feedback(
            "Not Interested",
            "Muốn tìm lựa chọn khác",
        )

        self.assertEqual(result["follow_up_task"], task_name)
        self.assertEqual(self._task_count(), 1)

        task = frappe.get_doc("CRM Task", task_name)
        self.assertEqual(task.status, "Canceled")

    def test_not_interested_to_interested_reopens_same_task(self):
        created = self._feedback("Interested")
        task_name = created["follow_up_task"]

        self._feedback(
            "Not Interested",
            "Muốn tìm lựa chọn khác",
        )
        result = self._feedback("Interested")

        self.assertEqual(result["follow_up_status"], "CREATED")
        self.assertEqual(result["follow_up_task"], task_name)
        self.assertEqual(self._task_count(), 1)

        task = frappe.get_doc("CRM Task", task_name)
        self.assertEqual(task.status, "Todo")

    def test_interested_without_assignee_saves_feedback_without_task(self):
        self.settings.default_follow_up_assignee = None
        self.settings.save(ignore_permissions=True)

        result = self._feedback("Interested")

        self.assertEqual(result["customer_feedback"], "Interested")
        self.assertEqual(result["follow_up_status"], "PENDING")
        self.assertIsNone(result["follow_up_task"])
        self.assertEqual(self._task_count(), 0)

        item = frappe.db.get_value(
            "Recommendation Item",
            self.item_id,
            ["customer_feedback", "follow_up_task"],
            as_dict=True,
        )
        self.assertEqual(item.customer_feedback, "Interested")
        self.assertFalse(item.follow_up_task)

    def test_not_interested_does_not_create_task(self):
        result = self._feedback(
            "Not Interested",
            "Muốn tìm lựa chọn khác",
        )

        self.assertEqual(result["customer_feedback"], "Not Interested")
        self.assertEqual(result["follow_up_status"], "NOT_APPLICABLE")
        self.assertIsNone(result["follow_up_task"])
        self.assertEqual(self._task_count(), 0)

    def test_invalid_rejection_reason_is_rejected(self):
        with self.assertRaises(frappe.ValidationError):
            self._feedback("Not Interested", "Invalid reason")

        self.assertEqual(self._task_count(), 0)
