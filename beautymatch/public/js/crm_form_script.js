// Separate CRM Form Script; it appends actions and preserves other controllers.
class CRMLead {
	async onLoad() {
		if (!this.doc?.name || this.doc.__islocal) return;
		const go = (path) => {
			sessionStorage.setItem(
				"beautymatch_customer_v1",
				JSON.stringify({ crm_lead: this.doc.name }),
			);
			sessionStorage.removeItem("beautymatch_open_session_v1");
			sessionStorage.removeItem("beautymatch_intake_retry_v1");
			sessionStorage.removeItem("beautymatch_sample_profile_v1");
			window.location.assign(path);
		};
		const actions = [
			{ label: "Tư vấn với BeautyMatch", onClick: () => go("/beautymatch/consultation") },
			{
				group: "BeautyMatch",
				buttonLabel: "BeautyMatch",
				items: [
					{ label: "Hồ sơ & lịch sử", onClick: () => go("/beautymatch/customer") },
					{ label: "Làm mới BeautyMatch", onClick: () => this.refreshBeautyMatch() },
				],
			},
		];
		for (const action of actions)
			if (
				!this.actions.some((existing) =>
					action.group
						? existing.group === action.group &&
							existing.buttonLabel === action.buttonLabel
						: existing.label === action.label,
				)
			)
				this.actions.push(action);
		await this.refreshBeautyMatch();
	}
	async refreshBeautyMatch() {
		if (typeof this.setFieldHtml !== "function" || this._beautymatchLoading) return;
		this._beautymatchLoading = true;
		const lead = this.doc.name;
		this.setFieldHtml(
			"beautymatch_insights",
			'<section class="bm-crm-insights" role="status">Đang tải hồ sơ BeautyMatch…</section>',
		);
		try {
			const [{ renderCRMInsights }, data] = await Promise.all([
				import("/assets/beautymatch/js/crm-insights.mjs?v=crm-botanical-20261105"),
				this.call("beautymatch.api.frontend.get_customer_view", { crm_lead: lead }),
			]);
			if (this.doc.name === lead)
				this.setFieldHtml("beautymatch_insights", renderCRMInsights(data));
		} catch (error) {
			if (this.doc.name === lead)
				this.setFieldHtml(
					"beautymatch_insights",
					'<section class="bm-crm-insights bm-crm-error" role="status">Chưa tải được hồ sơ BeautyMatch. Kiểm tra quyền truy cập hoặc dùng “Làm mới BeautyMatch” để thử lại.</section>',
				);
		} finally {
			this._beautymatchLoading = false;
		}
	}
}
