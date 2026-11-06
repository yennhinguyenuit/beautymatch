import frappe
from frappe.model.document import Document


class BeautyMatchContactRequest(Document):
    def validate(self):
        previous = self.get_doc_before_save()
        fields = ("customer", "crm_lead", "recommendation_session", "request_id", "payload_hash", "channel", "contact_value", "selected_items", "preferred_time", "customer_note", "contact_consent")
        if previous and any(self.get(key) != previous.get(key) for key in fields):
            frappe.throw("Xác nhận liên hệ đã gửi không được chỉnh sửa.")
