import frappe
from frappe.model.document import Document


class BeautyMatchCustomerRequest(Document):
    def validate(self):
        previous = self.get_doc_before_save()
        if previous and any(self.get(key) != previous.get(key) for key in (
            "request_id", "customer", "crm_lead", "beauty_profile", "profile_version", "payload_hash", "payload_json"
        )):
            frappe.throw("Bản chụp yêu cầu đã gửi không được thay đổi.", frappe.ValidationError)
