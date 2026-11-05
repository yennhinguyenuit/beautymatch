import frappe

no_cache = 1


def get_context(context):
	context.no_cache = 1
	context.bm_page = "result"
	context.csrf_token = frappe.sessions.get_csrf_token()
