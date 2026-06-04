"""
Success-Share Dashboard — Streamlit UI Component
==================================================

Renders the Success-Share Factory financial dashboard for the
Maneki-AI Streamlit web application.

Displays:
  - Real-time success metrics
  - Profit split history
  - Growth timeline
  - Service fee breakdown
"""

import streamlit as st
from datetime import datetime, timezone
from typing import Optional

from .core import FinancialClearingEngine
from .models import ServiceTier, TaskCategory


def render_success_share_dashboard(engine: Optional[FinancialClearingEngine] = None):
    """
    Render the Success-Share Factory dashboard in Streamlit.
    
    Call this from app.py to display the financial dashboard.
    """
    engine = engine or FinancialClearingEngine()
    
    st.markdown("---")
    st.markdown("## 🐱 Success-Share Factory")
    st.markdown(
        """
        <div style="background: linear-gradient(135deg, #0f1923 0%, #1a2332 100%);
                    border: 1px solid #2a3a4e; border-radius: 12px; padding: 1.2rem;
                    margin-bottom: 1rem;">
            <p style="color: #8ab4f8; margin: 0; font-size: 0.9rem;">
                <strong>Performance-Driven · Automated Profit Split · Shared Growth</strong>
            </p>
            <p style="color: #8899aa; margin: 4px 0 0 0; font-size: 0.8rem;">
                Our AI Board focuses exclusively on high-ROI tasks. We are compensated 
                only when your business generates value.
            </p>
        </div>
        """,
        unsafe_allow_html=True,
    )
    
    # ── Metrics Overview ───────────────────────────────────────────────────
    metrics = engine.get_metrics_dict()
    
    col1, col2, col3, col4 = st.columns(4, gap="small")
    
    with col1:
        st.metric(
            label="💰 Total Value Generated",
            value=metrics["display"]["total_value"],
            delta=f"{metrics['display']['avg_roi']} ROI",
        )
    
    with col2:
        st.metric(
            label="💳 Service Fees (Factory Share)",
            value=metrics["display"]["total_fees"],
            delta=f"{metrics['display']['success_rate']} Success Rate",
        )
    
    with col3:
        st.metric(
            label="📈 Net Profit",
            value=metrics["display"]["net_profit"],
            delta=f"{metrics['total_tasks_completed']} Tasks",
        )
    
    with col4:
        st.metric(
            label="⏱️ Client Time Saved",
            value=metrics["display"]["total_savings"],
            delta=f"@{metrics['display']['avg_roi']}",
        )
    
    # ── Service Tiers ──────────────────────────────────────────────────────
    st.markdown("### 📋 Service Tiers")
    
    tier_cols = st.columns(3, gap="medium")
    
    tier_info = [
        {
            "name": "Core",
            "icon": "🔧",
            "fee": "10%",
            "desc": "Basic task execution — single agent operations",
            "color": "#4fc3f7",
        },
        {
            "name": "Premium",
            "icon": "⚡",
            "fee": "20%",
            "desc": "Multi-agent orchestration with strategic planning",
            "color": "#ffb74d",
        },
        {
            "name": "Enterprise",
            "icon": "🏭",
            "fee": "30%",
            "desc": "Full factory pipeline with all engines (ECC + OpenClaw + Agent-S)",
            "color": "#81c784",
        },
    ]
    
    for i, (col, tier) in enumerate(zip(tier_cols, tier_info)):
        with col:
            st.markdown(
                f"""
                <div style="background: #0d1520; border-radius: 8px; padding: 1rem;
                            border-left: 3px solid {tier['color']}; height: 100%;">
                    <div style="font-size: 1.5rem; margin-bottom: 0.3rem;">{tier['icon']}</div>
                    <div style="color: {tier['color']}; font-weight: 700; font-size: 1.1rem;">
                        {tier['name']}
                    </div>
                    <div style="color: #4fc3f7; font-size: 1.3rem; font-weight: 700; margin: 0.3rem 0;">
                        {tier['fee']}
                    </div>
                    <div style="color: #8899aa; font-size: 0.8rem;">
                        {tier['desc']}
                    </div>
                </div>
                """,
                unsafe_allow_html=True,
            )
    
    # ── Recent Settlements ─────────────────────────────────────────────────
    st.markdown("### 📄 Recent Settlements")
    
    splits = engine.tracker.list_splits()
    if splits:
        # Show last 5 settlements
        recent = sorted(splits, key=lambda s: s.created_at, reverse=True)[:5]
        
        for split in recent:
            with st.expander(
                f"**{split.task_id}** — "
                f"Gross: ${split.gross_value:.2f} | "
                f"Fee: ${split.service_charge:.2f} | "
                f"Client: ${split.client_share:.2f}",
                expanded=False,
            ):
                cols = st.columns(3)
                with cols[0]:
                    st.markdown(f"**Task ID:** `{split.task_id}`")
                    st.markdown(f"**Status:** {'✅ Settled' if split.settled else '⏳ Pending'}")
                    st.markdown(f"**Created:** {split.created_at[:19]}")
                with cols[1]:
                    st.markdown(f"**Gross Value:** ${split.gross_value:.2f}")
                    st.markdown(f"**Net Profit:** ${split.net_profit:.2f}")
                    st.markdown(f"**ROI:** {split.valuation.roi}x")
                with cols[2]:
                    st.markdown(f"**Service Fee ({split.service_fee.percentage*100:.0f}%):** ${split.service_charge:.2f}")
                    st.markdown(f"**Client Share:** ${split.client_share:.2f}")
                    st.markdown(f"**Factory Share:** ${split.factory_share:.2f}")
    else:
        st.info("No settlements yet. Complete a task to see the first profit split.")
    
    # ── Growth Timeline ────────────────────────────────────────────────────
    st.markdown("### 📈 Growth Timeline")
    
    growth_records = engine.get_growth_timeline()
    if growth_records:
        # Simple table display
        growth_data = []
        for r in growth_records:
            growth_data.append({
                "Period": r["period"],
                "Tasks": r["tasks_completed"],
                "Total Value": f"${r['total_value']:,.2f}",
                "Total Fees": f"${r['total_fees']:,.2f}",
                "Avg ROI": f"{r['avg_roi']}x",
                "Efficiency Gain": f"{r['efficiency_gain']:+.2f}%",
            })
        
        st.dataframe(growth_data, use_container_width=True, hide_index=True)
    else:
        st.info("No growth records yet. Generate a period report to see growth data.")
    
    # ── Generate Report Button ─────────────────────────────────────────────
    st.markdown("### 📊 Generate Period Report")
    
    report_col1, report_col2 = st.columns([1, 3])
    
    with report_col1:
        period_type = st.selectbox(
            "Report Period",
            ["Monthly", "Quarterly"],
            index=0,
        )
    
    with report_col2:
        st.markdown("<br>", unsafe_allow_html=True)
        if st.button("📊 Generate Success-Share Report", type="primary", use_container_width=True):
            now = datetime.now(timezone.utc)
            if period_type == "Monthly":
                period = now.strftime("%Y-%m")
            else:
                quarter = (now.month - 1) // 3 + 1
                period = f"{now.year}-Q{quarter}"
            
            with st.spinner(f"Generating {period_type.lower()} report for {period}..."):
                report = engine.generate_period_report(period)
            
            st.success(f"✅ Report generated for {report['period']}")
            
            # Show report summary
            st.json(report["display"])
    
    st.markdown("---")
    st.caption(
        "🐱 **Maneki-AI Success-Share Factory** — "
        "Your success is our sole metric. "
        "The more efficient the AI pipeline becomes, the higher your margins."
    )


def render_settlement_form(engine: Optional[FinancialClearingEngine] = None):
    """
    Render a form to manually settle a task (for testing/demo purposes).
    """
    engine = engine or FinancialClearingEngine()
    
    st.markdown("### 🧪 Manual Task Settlement (Demo)")
    st.markdown("Use this form to simulate task settlement for testing.")
    
    with st.form("settlement_form", clear_on_submit=True):
        col1, col2 = st.columns(2)
        
        with col1:
            task_id = st.text_input(
                "Task ID",
                value=f"TASK_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}",
            )
            category = st.selectbox(
                "Category",
                options=[c.value for c in TaskCategory],
                index=0,
            )
            estimated_value = st.number_input(
                "Estimated Value (USD)",
                min_value=0.0,
                value=100.0,
                step=10.0,
            )
        
        with col2:
            cost_incurred = st.number_input(
                "Cost Incurred (USD)",
                min_value=0.0,
                value=5.0,
                step=1.0,
                help="API costs, compute, etc.",
            )
            time_saved = st.number_input(
                "Time Saved (hours)",
                min_value=0.0,
                value=2.0,
                step=0.5,
            )
            tier = st.selectbox(
                "Service Tier",
                options=[t.value for t in ServiceTier],
                index=0,
            )
        
        submitted = st.form_submit_button(
            "💰 Settle Task", type="primary", use_container_width=True
        )
    
    if submitted:
        if not task_id.strip():
            st.error("Task ID cannot be empty.")
            return
        
        with st.spinner("Settling task..."):
            result = engine.process_completed_task(
                task_id=task_id.strip(),
                category=category,
                estimated_value=estimated_value,
                cost_incurred=cost_incurred,
                time_saved_hours=time_saved,
                tier=tier,
            )
        
        st.success(f"✅ Task {task_id} settled successfully!")
        
        summary = result["summary"]
        st.markdown(
            f"""
            <div style="background: #0d1520; border-radius: 8px; padding: 1rem;
                        border-left: 3px solid #81c784; margin-top: 0.5rem;">
                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1rem;">
                    <div>
                        <div style="color: #8899aa; font-size: 0.75rem;">Gross Value</div>
                        <div style="color: #fff; font-size: 1.2rem; font-weight: 700;">
                            ${summary['gross_value']:.2f}
                        </div>
                    </div>
                    <div>
                        <div style="color: #8899aa; font-size: 0.75rem;">Service Fee ({summary['fee_percentage']:.0f}%)</div>
                        <div style="color: #ffb74d; font-size: 1.2rem; font-weight: 700;">
                            ${summary['service_charge']:.2f}
                        </div>
                    </div>
                    <div>
                        <div style="color: #8899aa; font-size: 0.75rem;">Client Share</div>
                        <div style="color: #81c784; font-size: 1.2rem; font-weight: 700;">
                            ${summary['client_share']:.2f}
                        </div>
                    </div>
                </div>
                <div style="margin-top: 0.5rem; color: #4fc3f7; font-size: 0.85rem;">
                    ROI: {summary['roi']}x
                </div>
            </div>
            """,
            unsafe_allow_html=True,
        )
