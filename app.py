import streamlit as st
import requests
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from datetime import datetime
import os

# App configuration
st.set_page_config(
    page_title="Ramsey Progress",
    page_icon="📈",
    layout="wide"
)

# API Configuration
api_base_url = os.environ.get("API_BASE_URL", "http://localhost:4040")


def fetch_stages(campaign_id: int, limit: int = 50):
    """Fetch stages for a campaign, ordered by creation date descending."""
    url = f"{api_base_url}/api/ramsey/stages"
    params = {"campaignId": campaign_id}
    
    try:
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        stages = response.json()
        # Sort by stageId descending (most recent first) and limit
        stages = sorted(stages, key=lambda x: x.get('stageId', 0), reverse=True)[:limit]
        return stages
    except requests.exceptions.RequestException as e:
        st.error(f"Failed to fetch stages: {e}")
        return []


def fetch_graph(graph_id: int):
    """Fetch a graph by ID to get clique count."""
    url = f"{api_base_url}/api/ramsey/graphs/{graph_id}"
    
    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        return None


def get_stage_progression_data(stages):
    """Build progression data: stage_id, graph_id, clique_count, created_date."""
    data = []
    
    for stage in stages:
        graph_id = stage.get('baseGraphId')
        if not graph_id:
            continue
            
        graph = fetch_graph(graph_id)
        if not graph:
            continue
            
        clique_count = graph.get('cliqueCount')
        if clique_count is None:
            continue
            
        data.append({
            'stage_id': stage.get('stageId'),
            'graph_id': graph_id,
            'clique_count': clique_count,
            'status': stage.get('status'),
            'created_date': stage.get('createdDate')
        })
    
    return data


# Sidebar
with st.sidebar:
    st.header("Configuration")
    campaign_id = int(os.environ.get("RAMSEY_CAMPAIGN_ID", "1"))
    st.info(f"Campaign ID: {campaign_id}")
    
    max_stages = st.slider("Max Stages to Display", min_value=10, max_value=100, value=50)
    
    if st.button("🔄 Refresh"):
        st.rerun()
    
    st.write(f"Last updated: {datetime.now().strftime('%H:%M:%S')}")


# Main content
st.title("📈 Ramsey Clique Count Progression")
st.markdown("Tracking improvements in clique count across stages")

# Fetch and process data
with st.spinner("Fetching stage data..."):
    stages = fetch_stages(campaign_id, limit=max_stages)

if not stages:
    st.warning("No stages found for this campaign.")
    st.stop()

with st.spinner("Fetching graph data for each stage..."):
    progression_data = get_stage_progression_data(stages)

if not progression_data:
    st.warning("No progression data available (graphs may not have clique counts).")
    st.stop()

# Create DataFrame
df = pd.DataFrame(progression_data)
# Sort by stage_id ascending for chronological order
df = df.sort_values('stage_id', ascending=True)

# Current stats
col1, col2, col3, col4 = st.columns(4)

current = df.iloc[-1]
first = df.iloc[0]

with col1:
    st.metric("Current Stage", f"#{int(current['stage_id'])}")

with col2:
    st.metric(
        "Current Clique Count", 
        f"{int(current['clique_count']):,}",
        delta=f"{int(current['clique_count'] - first['clique_count']):,} from start",
        delta_color="inverse"
    )

with col3:
    improvement = first['clique_count'] - current['clique_count']
    st.metric("Total Improvement", f"{int(improvement):,}")

with col4:
    st.metric("Stages Analyzed", f"{len(df):,}")

st.markdown("---")

# Main chart - Clique Count over Stages
st.subheader("Clique Count Over Time")

fig = go.Figure()

# Add line trace
fig.add_trace(go.Scatter(
    x=df['stage_id'],
    y=df['clique_count'],
    mode='lines+markers',
    name='Clique Count',
    line=dict(color='#2ecc71', width=3),
    marker=dict(size=8),
    hovertemplate=(
        '<b>Stage %{x}</b><br>'
        'Clique Count: %{y:,}<br>'
        '<extra></extra>'
    )
))

# Highlight active stage
active_stages = df[df['status'] == 'ACTIVE']
if not active_stages.empty:
    fig.add_trace(go.Scatter(
        x=active_stages['stage_id'],
        y=active_stages['clique_count'],
        mode='markers',
        name='Active Stage',
        marker=dict(size=15, color='#e74c3c', symbol='star'),
        hovertemplate=(
            '<b>ACTIVE Stage %{x}</b><br>'
            'Clique Count: %{y:,}<br>'
            '<extra></extra>'
        )
    ))

fig.update_layout(
    xaxis_title="Stage ID",
    yaxis_title="Clique Count",
    height=500,
    hovermode='x unified',
    showlegend=True,
    legend=dict(
        yanchor="top",
        y=0.99,
        xanchor="right",
        x=0.99
    )
)

st.plotly_chart(fig, width='stretch')

# Improvement rate chart
st.subheader("Improvement Per Stage")

df['improvement'] = df['clique_count'].diff() * -1  # Negative diff = improvement
df_improvements = df.dropna(subset=['improvement'])

if not df_improvements.empty:
    colors = ['#2ecc71' if x > 0 else '#e74c3c' for x in df_improvements['improvement']]
    
    fig2 = go.Figure(go.Bar(
        x=df_improvements['stage_id'],
        y=df_improvements['improvement'],
        marker_color=colors,
        hovertemplate=(
            '<b>Stage %{x}</b><br>'
            'Improvement: %{y:,}<br>'
            '<extra></extra>'
        )
    ))
    
    fig2.update_layout(
        xaxis_title="Stage ID",
        yaxis_title="Cliques Reduced",
        height=300
    )
    
    st.plotly_chart(fig2, width='stretch')

# Data table
with st.expander("📋 Raw Data"):
    display_df = df[['stage_id', 'graph_id', 'clique_count', 'status', 'created_date']].copy()
    display_df.columns = ['Stage', 'Graph ID', 'Clique Count', 'Status', 'Created']
    st.dataframe(display_df, width='stretch', hide_index=True)