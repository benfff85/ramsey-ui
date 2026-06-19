import streamlit as st
from streamlit_autorefresh import st_autorefresh
import requests
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from datetime import datetime
import os
import redis
import time

# App configuration
st.set_page_config(
    page_title="Ramsey Progress",
    page_icon="📈",
    layout="wide"
)

# Auto-refresh every 30 seconds
st_autorefresh(interval=30000, key="datarefresh")

# API Configuration
api_base_url = os.environ.get("API_BASE_URL", "http://localhost:36000")

# Redis Configuration
redis_host = os.environ.get("REDIS_HOST", "localhost")
redis_port = int(os.environ.get("REDIS_PORT", "6379"))


def get_redis_client():
    """Create Redis client connection."""
    try:
        return redis.Redis(host=redis_host, port=redis_port, decode_responses=True)
    except Exception as e:
        st.warning(f"Could not connect to Redis: {e}")
        return None


def get_processed_count(redis_client, stage_id: int):
    """Get processed work unit count from Redis."""
    if not redis_client:
        return None
    try:
        count = redis_client.get(f"processed_count:{stage_id}")
        return int(count) if count else 0
    except Exception:
        return None


def get_stage_progress(redis_client, stage_id: int):
    """Get stage progress (current index / total pairs) from Redis."""
    if not redis_client:
        return None, None
    try:
        import json
        current_index = redis_client.get(f"stage_work_index:{stage_id}")
        config_json = redis_client.get(f"stage_config:{stage_id}")
        
        if current_index is None or config_json is None:
            return None, None
        
        current = int(current_index)
        config = json.loads(config_json)
        total = config.get('totalPairs', 0)
        
        return current, total
    except Exception:
        return None, None


def get_best_results(redis_client, stage_id: int):
    """Get all best *novel* results (lowest clique count) from the Redis sorted set.
    The set is already capped at TOP_RESULTS_COUNT by the worker's trim, so we
    return everything retained (best first) rather than a fixed top-N."""
    if not redis_client:
        return []

    try:
        # zrange 0..-1 returns the whole set (lowest scores first), with scores.
        results = redis_client.zrange(
            f"best_results:{stage_id}",
            0,
            -1,
            withscores=True
        )

        parsed_results = []
        import json

        for member, score in results:
            try:
                data = json.loads(member)
                # Format edges for display: [(u, v), ...]
                edges = []
                if 'edgesToFlip' in data:
                    for edge in data['edgesToFlip']:
                        u = edge.get('vertexOne') or edge.get('vertex_one')
                        v = edge.get('vertexTwo') or edge.get('vertex_two')
                        if u is not None and v is not None:
                            edges.append((u, v))

                # Legacy SA/VDS/tabu results carry a full graphBitstring instead of
                # edges; show something meaningful rather than an empty "[]".
                if edges:
                    edges_display = str(edges)
                elif data.get('graphBitstring'):
                    edges_display = "(full-graph result)"
                else:
                    edges_display = "—"

                parsed_results.append({
                    'clique_count': int(score),
                    'edges': edges_display,
                    'timestamp': datetime.now().strftime("%H:%M:%S") # Proxy since we don't store time
                })
            except json.JSONDecodeError:
                continue

        return parsed_results
    except Exception as e:
        print(f"Error fetching best results: {e}")
        return []


@st.cache_data(ttl=60)
def fetch_campaigns():
    """Fetch all campaigns from the middleware. Cached for 60s."""
    url = f"{api_base_url}/api/ramsey/campaigns"
    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        st.error(f"Failed to fetch campaigns: {e}")
        return []


def fetch_progression(campaign_id: int):
    """Fetch progression data for a campaign."""
    url = f"{api_base_url}/api/ramsey/campaigns/{campaign_id}/progression"
    
    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        # Map camelCase to snake_case for DataFrame compatibility
        formatted_data = []
        for item in data:
            formatted_data.append({
                'stage_id': item.get('stageId'),
                'graph_id': item.get('graphId'),
                'clique_count': item.get('cliqueCount'),
                'status': item.get('status'),
                'created_date': item.get('createdDate')
            })
            
        return formatted_data
    except requests.exceptions.RequestException as e:
        st.error(f"Failed to fetch progression data: {e}")
        return []


# Sidebar
with st.sidebar:
    st.header("Configuration")

    campaigns = fetch_campaigns()
    # Only an explicitly-set env var overrides the default; otherwise default to the
    # latest-updated ACTIVE campaign on page load.
    env_campaign_id = os.environ.get("RAMSEY_CAMPAIGN_ID")

    if campaigns:
        def _updated_ts(c):
            raw = c.get('updatedDate') or c.get('createdDate')
            if not raw:
                return 0.0
            try:
                return datetime.fromisoformat(str(raw).replace('Z', '+00:00')).timestamp()
            except Exception:
                return 0.0

        # ACTIVE first, then most-recently-updated first (campaignId as final tiebreak)
        campaigns_sorted = sorted(
            campaigns,
            key=lambda c: (
                0 if c.get('status') == 'ACTIVE' else 1,
                -_updated_ts(c),
                -int(c.get('campaignId', 0)),
            )
        )

        def _label(c):
            return (
                f"#{c.get('campaignId')} — {c.get('vertexCount')}v / k={c.get('subgraphSize')} "
                f"({c.get('status')})"
            )

        labels = [_label(c) for c in campaigns_sorted]
        ids = [int(c.get('campaignId')) for c in campaigns_sorted]

        # Default to the latest-updated active campaign (top of the sorted list);
        # honor RAMSEY_CAMPAIGN_ID only when it is explicitly set and present.
        default_idx = 0
        if env_campaign_id and env_campaign_id.isdigit() and int(env_campaign_id) in ids:
            default_idx = ids.index(int(env_campaign_id))

        selected_label = st.selectbox(
            "Campaign",
            labels,
            index=default_idx,
            key="selected_campaign_label",
        )
        campaign_id = ids[labels.index(selected_label)]
    else:
        campaign_id = int(env_campaign_id) if (env_campaign_id and env_campaign_id.isdigit()) else 1
        st.info(f"Campaign ID: {campaign_id} (no campaign list available)")

    max_stages = st.slider("Max Stages to Display", min_value=10, max_value=2500, value=250)

    if st.button("🔄 Refresh"):
        fetch_campaigns.clear()
        st.rerun()

    st.write(f"Last updated: {datetime.now().strftime('%H:%M:%S')}")


# Main content
st.title("📈 Ramsey Clique Count Progression")
st.markdown("Tracking improvements in clique count across stages")

# Fetch and process data
# Fetch and process data
with st.spinner("Fetching progression data..."):
    progression_data = fetch_progression(campaign_id)
    # Filter to limit based on slider if needed, though backend returns all sorted by date asc usually
    # But UI expects chrono order. Backend returns sorting by createdDate ASC.
    # The existing UI logic sorted by stage_id ascending later.
    
if not progression_data:
    st.warning("No progression data available.")
    st.stop()
    
# Apply max limit logic if desired, or relying on pandas later.
# The user wants to see the chart. Let's keep all data but slicing might be good if too many points.
# The previous code limited stages fetched. Here we fetch all (progression endpoint implies summary).
# We can slice the last N items.
if len(progression_data) > max_stages:
    progression_data = progression_data[-max_stages:]

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

# Identify active stage for Redis metrics and chart highlighting
active_stages = df[df['status'] == 'ACTIVE']

# Redis metrics for active stage
redis_client = get_redis_client()
if redis_client and not active_stages.empty:
    active_stage_id = int(active_stages.iloc[0]['stage_id'])
    
    processed = get_processed_count(redis_client, active_stage_id)
    current_index, total_pairs = get_stage_progress(redis_client, active_stage_id)
    
    # Calculate throughput from previous refresh
    throughput = None
    elapsed = None
    if processed is not None and 'prev_processed_count' in st.session_state:
        prev_count = st.session_state.prev_processed_count
        prev_time = st.session_state.prev_refresh_time
        prev_stage = st.session_state.get('prev_stage_id', active_stage_id)
        
        now = time.time()
        elapsed = now - prev_time
        count_diff = processed - prev_count
        
        # Only show if same stage, positive diff, and at least 5 seconds elapsed
        if prev_stage == active_stage_id and count_diff >= 0 and elapsed >= 5:
            throughput = count_diff / elapsed
    
    # Store current values for next refresh
    if processed is not None:
        st.session_state.prev_processed_count = processed
        st.session_state.prev_refresh_time = time.time()
        st.session_state.prev_stage_id = active_stage_id
    
    col5, col6, col7 = st.columns(3)
    
    with col5:
        if processed is not None:
            st.metric("Work Units Processed (Stage " + str(active_stage_id) + ")", f"{processed:,}")
    
    with col6:
        if current_index is not None and total_pairs is not None and total_pairs > 0:
            # Cap display at total_pairs (counter may exceed due to race conditions)
            display_index = min(current_index, total_pairs)
            progress_pct = min(100.0, (current_index / total_pairs) * 100)
            st.metric("Stage Progress", f"{progress_pct:.1f}%", delta=f"{display_index:,} / {total_pairs:,}")
    
    with col7:
        if throughput is not None:
            st.metric("Throughput", f"{throughput:,.0f}/sec", 
                     delta=f"over {elapsed:.0f}s")
        else:
            st.metric("Throughput", "—", delta="refresh to calculate")

    # Best Results
    best_results = get_best_results(redis_client, active_stage_id)
    st.markdown(
        f"### 🏆 Best Novel Results — {len(best_results)} retained "
        "(lowest clique counts, unvisited)"
    )
    
    if best_results:
        best_df = pd.DataFrame(best_results)
        
        # Calculate diff from current stage count
        current_clique_count = current['clique_count']
        best_df['diff'] = best_df['clique_count'] - current_clique_count
        
        # Reorder columns
        best_df = best_df[['clique_count', 'diff', 'edges']]
        best_df.columns = ['Clique Count', 'Diff vs Current', 'Edges to Flip']
        best_df.index += 1 # 1-based ranking
        st.dataframe(best_df, width='stretch')
    else:
        st.info("No results submitted yet for this stage.")

st.markdown("---")

# Main chart - Clique Count over Stages
st.subheader("Clique Count Over Time")

fig = go.Figure()

# Add line trace
fig.add_trace(go.Scatter(
    x=df['created_date'],
    y=df['clique_count'],
    mode='lines+markers',
    name='Clique Count',
    line=dict(color='#2ecc71', width=3),
    marker=dict(size=8),
    hovertemplate=(
        '<b>Stage %{customdata}</b><br>'
        '%{x}<br>'
        'Clique Count: %{y:,}<br>'
        '<extra></extra>'
    ),
    customdata=df['stage_id']
))

# Highlight active stage on chart
if not active_stages.empty:
    fig.add_trace(go.Scatter(
        x=active_stages['created_date'],
        y=active_stages['clique_count'],
        mode='markers',
        name='Active Stage',
        marker=dict(size=15, color='#e74c3c', symbol='star'),
        hovertemplate=(
            '<b>ACTIVE Stage %{customdata}</b><br>'
            '%{x}<br>'
            'Clique Count: %{y:,}<br>'
            '<extra></extra>'
        ),
        customdata=active_stages['stage_id']
    ))

fig.update_layout(
    xaxis_title="Date",
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
        x=df_improvements['stage_id'].astype(str),
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
        height=300,
        xaxis=dict(type='category')
    )
    
    st.plotly_chart(fig2, width='stretch')

# Data table
with st.expander("📋 Raw Data"):
    display_df = df[['stage_id', 'graph_id', 'clique_count', 'status', 'created_date']].copy()
    display_df.columns = ['Stage', 'Graph ID', 'Clique Count', 'Status', 'Created']
    st.dataframe(display_df, width='stretch', hide_index=True)