/* BeautyMatch integration for Frappe CRM Lead */

function bm_escape(value) {
    return frappe.utils.escape_html(String(value ?? "-"));
}

function bm_safe_url(value) {
    return /^https?:\/\//i.test(value || "") ? value : "";
}

function bm_render_summary(data) {
    const profiles = data.beauty_profiles || [];
    const history = data.history || [];

    let html = `
        <div class="bm-summary">
            <div class="row" style="margin-bottom:20px">
                <div class="col-sm-4">
                    <div class="dashboard-widget-box">
                        <div class="widget-title">Beauty Profiles</div>
                        <div class="widget-body" style="font-size:24px">
                            ${profiles.length}
                        </div>
                    </div>
                </div>
                <div class="col-sm-4">
                    <div class="dashboard-widget-box">
                        <div class="widget-title">Consultation Sessions</div>
                        <div class="widget-body" style="font-size:24px">
                            ${data.total_sessions || 0}
                        </div>
                    </div>
                </div>
                <div class="col-sm-4">
                    <div class="dashboard-widget-box">
                        <div class="widget-title">Interested Products</div>
                        <div class="widget-body" style="font-size:24px">
                            ${(data.interested_products || []).length}
                        </div>
                    </div>
                </div>
            </div>

            <h5>Customer Beauty Profiles</h5>
    `;

    if (!profiles.length) {
        html += `<p class="text-muted">Khách hàng chưa có hồ sơ BeautyMatch.</p>`;
    } else {
        profiles.forEach(profile => {
            html += `
                <div class="bm-card">
                    <strong>${bm_escape(profile.name)}</strong>
                    <span class="indicator-pill green">
                        ${bm_escape(profile.status)}
                    </span>
                    <div class="text-muted small">
                        Updated: ${bm_escape(profile.modified)}
                    </div>
                </div>
            `;
        });
    }

    html += `<hr><h5>Recommendation History</h5>`;

    if (!history.length) {
        html += `<p class="text-muted">Chưa có lịch sử tư vấn.</p>`;
    }

    history.forEach(session => {
        html += `
            <div class="bm-card" style="margin-bottom:16px">
                <div class="row">
                    <div class="col-sm-8">
                        <strong>Session: ${bm_escape(session.session_id)}</strong>
                    </div>
                    <div class="col-sm-4 text-right">
                        <span class="indicator-pill blue">
                            ${bm_escape(session.status)}
                        </span>
                    </div>
                </div>

                <div class="text-muted small" style="margin-top:8px">
                    Category: ${bm_escape(session.requested_category)}
                    &nbsp;|&nbsp;
                    Budget: ${frappe.format(
                        session.max_budget,
                        {fieldtype: "Currency"}
                    )}
                </div>

                <div style="margin-top:12px">
        `;

        (session.results || []).forEach(item => {
            const url = bm_safe_url(item.product_url);
            const image = bm_safe_url(item.image_url);

            html += `
                <div style="display:flex;gap:12px;padding:12px 0;border-top:1px solid var(--border-color)">
                    ${image ? `
                        <img src="${bm_escape(image)}"
                             style="width:65px;height:65px;object-fit:cover;border-radius:6px">
                    ` : ""}

                    <div style="flex:1">
                        <strong>
                            ${url
                                ? `<a href="${bm_escape(url)}" target="_blank" rel="noopener noreferrer">${bm_escape(item.product_name)}</a>`
                                : bm_escape(item.product_name)}
                        </strong>

                        <div class="text-muted small">
                            ${bm_escape(item.brand)}
                            &nbsp;|&nbsp;
                            ${frappe.format(item.price, {fieldtype: "Currency"})}
                            &nbsp;|&nbsp;
                            Match: ${bm_escape(item.final_match_score)}%
                        </div>

                        <div style="margin-top:5px">
                            Feedback:
                            <strong>${bm_escape(item.customer_feedback)}</strong>
                        </div>
                    </div>
                </div>
            `;
        });

        html += `
                </div>
            </div>
        `;
    });

    html += `</div>`;
    return html;
}

function bm_open_insights(frm) {
    const dialog = new frappe.ui.Dialog({
        title: __("BeautyMatch Customer Insights"),
        size: "large",
        fields: [
            {
                fieldtype: "HTML",
                fieldname: "summary_html"
            }
        ]
    });

    dialog.fields_dict.summary_html.$wrapper.html(
        `<div class="text-muted">${__("Loading BeautyMatch data...")}</div>`
    );

    dialog.show();

    frappe.call({
        method: "beautymatch.api.lead_summary.get_lead_summary",
        args: {
            crm_lead: frm.doc.name
        },
        freeze: true,
        freeze_message: __("Loading customer insights...")
    }).then(response => {
        const data = response.message;

        dialog.fields_dict.summary_html.$wrapper.html(
            bm_render_summary(data)
        );
    }).catch(() => {
        dialog.fields_dict.summary_html.$wrapper.html(
            `<div class="text-danger">
                ${__("Unable to load BeautyMatch information. Check your permissions and try again.")}
            </div>`
        );
    });
}

frappe.ui.form.on("CRM Lead", {
    refresh(frm) {
        if (frm.is_new()) return;

        const openBeautyMatch = (path) => {
            sessionStorage.setItem('beautymatch_customer_v1',JSON.stringify({crm_lead:frm.doc.name}));
            sessionStorage.removeItem('beautymatch_open_session_v1');
            window.location.assign(path);
        };
        frm.add_custom_button('Bắt đầu tư vấn',()=>openBeautyMatch('/beautymatch/consultation'),'BeautyMatch');
        frm.add_custom_button('Hồ sơ & lịch sử',()=>openBeautyMatch('/beautymatch/customer'),'BeautyMatch');

        frm.add_custom_button(
            __("BeautyMatch Insights"),
            () => bm_open_insights(frm),
            __("BeautyMatch")
        );
    }
});
