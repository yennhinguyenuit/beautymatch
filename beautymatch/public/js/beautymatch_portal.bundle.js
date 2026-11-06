// Frappe hashes this complete dependency graph. Never mix a new portal entry
// with an older, cached intake-domain module from a previous deployment.
import { startPortal } from "./portal.mjs";
startPortal().catch(() => {
	window.beautymatchPortalBooted = false;
	window.beautymatchPortalBootError?.();
});
