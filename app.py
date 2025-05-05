import streamlit as st
import requests
import pandas as pd
import altair as alt
import plotly.graph_objects as go
import plotly.express as px
from datetime import datetime
import os
import math

# App title and configuration
st.set_page_config(
    page_title="Work Units Dashboard",
    page_icon="📊",
    layout="wide"
)

# Function to query GraphQL API
def query_graphql(api_url, query):
    headers = {
        "Content-Type": "application/json",
        # Add any authentication headers if needed
        # "Authorization": f"Bearer {your_token}"
    }

    response = requests.post(
        api_url,
        json={"query": query},
        headers=headers
    )

    if response.status_code == 200:
        return response.json()
    else:
        st.error(f"GraphQL query failed: {response.status_code} - {response.text}")
        return None

# Function to fetch data from REST API
def fetch_rest_api(base_url, endpoint, params=None):
    url = f"{base_url}{endpoint}"

    try:
        response = requests.get(url, params=params)
        response.raise_for_status()  # Raise exception for 4XX/5XX responses
        return response.json()
    except requests.exceptions.RequestException as e:
        st.error(f"REST API request failed: {str(e)}")
        return None

# App Header
st.title("Work Units Processing Dashboard")
st.subheader("Real-time monitoring of work unit processing status")

# Sidebar for configuration
with st.sidebar:
    st.header("Configuration")
    api_base_url = os.environ.get("API_BASE_URL") or st.text_input("API Base URL", value="http://localhost:4040")
    graphql_endpoint = "/graphql"
    graphql_url = f"{api_base_url}{graphql_endpoint}"

    total_work_units = 427000000  # Your specified total of 427 million
    st.info(f"Total work units: {total_work_units:,}")

    # Add a refresh button
    if st.button("Refresh Data"):
        st.rerun()

    # Display last update time
    st.write(f"Last updated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

# Main page content
st.header("Work Units Progress")
col1, col2 = st.columns(2)

# GraphQL query
stage_id = os.getenv('STAGE_ID', 'default_value')

gql_query = """
query {
    summary {
        stageSummary(stageId: """ + stage_id + """, workUnitStatusList: [COMPLETE]) {
            stageId
            workUnitCount
            workUnitStatusList
        }
    }
}
"""

# Execute GraphQL query
with st.spinner("Fetching data from GraphQL API..."):
    result = query_graphql(graphql_url, gql_query)

# Process data if query successful
if result:
    try:
        # Extract data from result
        stage_summary = result["data"]["summary"]["stageSummary"]
        complete_work_units = stage_summary["workUnitCount"]
        remaining_work_units = total_work_units - complete_work_units
        completion_percentage = (complete_work_units / total_work_units) * 100

        # Display metrics in the first column
        with col1:
            st.metric(
                label="Completed Work Units",
                value=f"{complete_work_units:,}",
                delta=f"{completion_percentage:.2f}% of total"
            )

            st.metric(
                label="Remaining Work Units",
                value=f"{remaining_work_units:,}",
                delta=f"{100 - completion_percentage:.2f}% of total"
            )

            # Create a status dataframe
            status_df = pd.DataFrame({
                'Status': ['Completed', 'Remaining'],
                'Count': [complete_work_units, remaining_work_units]
            })

            # Create bar chart with Altair
            bar_chart = alt.Chart(status_df).mark_bar().encode(
                x=alt.X('Status:N', title='Status'),
                y=alt.Y('Count:Q', title='Work Units'),
                color=alt.Color('Status:N', scale=alt.Scale(domain=['Completed', 'Remaining'],
                                                            range=['#2ecc71', '#e74c3c']))
            ).properties(
                title='Work Units by Status'
            )

            st.altair_chart(bar_chart, use_container_width=True)

        # Display visual representations in the second column
        with col2:
            # Progress bar
            st.subheader("Completion Progress")
            st.progress(completion_percentage / 100)
            st.write(f"{completion_percentage:.2f}% complete")

            # Create gauge chart with Plotly
            fig = go.Figure(go.Indicator(
                mode="gauge+number+delta",
                value=completion_percentage,
                domain={'x': [0, 1], 'y': [0, 1]},
                title={'text': "Completion Percentage"},
                gauge={
                    'axis': {'range': [0, 100]},
                    'bar': {'color': "#2ecc71"},
                    'steps': [
                        {'range': [0, 25], 'color': "#f39c12"},
                        {'range': [25, 50], 'color': "#f1c40f"},
                        {'range': [50, 75], 'color': "#27ae60"},
                        {'range': [75, 100], 'color': "#2ecc71"}
                    ],
                    'threshold': {
                        'line': {'color': "red", 'width': 4},
                        'thickness': 0.75,
                        'value': 100
                    }
                }
            ))

            st.plotly_chart(fig, use_container_width=True)

    except Exception as e:
        st.error(f"Error processing data: {str(e)}")
        st.json(result)  # Show raw result for debugging
else:
    st.warning("No work unit data available. Please check your API connection and configuration.")

# Client Analysis Section
st.markdown("---")
st.header("Client Analysis")

# Fetch clients from REST API
with st.spinner("Fetching client data from REST API..."):
    clients = fetch_rest_api(api_base_url, "/api/ramsey/clients")

if clients and len(clients) > 0:
    # Convert to DataFrame for easier analysis
    clients_df = pd.DataFrame(clients)

    # Display total number of clients
    st.subheader(f"Total Clients: {len(clients_df)}")

    # Create columns for visualizations
    col1, col2, col3 = st.columns([2, 2, 3])

    with col1:
        # Count clients by type
        type_counts = clients_df['type'].value_counts().reset_index()
        type_counts.columns = ['Type', 'Count']

        # Create chart for client types
        fig_types = px.pie(
            type_counts,
            values='Count',
            names='Type',
            title='Clients by Type',
            color_discrete_sequence=px.colors.qualitative.Set3,
            hole=0.4
        )
        st.plotly_chart(fig_types, use_container_width=True)

    with col2:
        # Count clients by status
        status_counts = clients_df['status'].value_counts().reset_index()
        status_counts.columns = ['Status', 'Count']

        # Create chart for client status
        colors = {'ACTIVE': '#2ecc71', 'INACTIVE': '#e74c3c'}
        fig_status = px.pie(
            status_counts,
            values='Count',
            names='Status',
            title='Clients by Status',
            color='Status',
            color_discrete_map=colors,
            hole=0.4
        )
        st.plotly_chart(fig_status, use_container_width=True)

    with col3:
        # Create grouped bar chart for type and status
        type_status_df = clients_df.groupby(['type', 'status']).size().reset_index(name='count')

        bar_chart = px.bar(
            type_status_df,
            x='type',
            y='count',
            color='status',
            title='Client Distribution by Type and Status',
            labels={'type': 'Client Type', 'count': 'Number of Clients', 'status': 'Status'},
            color_discrete_map={'ACTIVE': '#2ecc71', 'INACTIVE': '#e74c3c'}
        )

        st.plotly_chart(bar_chart, use_container_width=True)

    # Filter for ACTIVE CLIQUECHECKER clients
    active_cliquecheckers = clients_df[(clients_df['type'] == 'CLIQUECHECKER') & (clients_df['status'] == 'ACTIVE')].copy()

    # Display ACTIVE CLIQUECHECKER details
    st.subheader(f"Active CLIQUECHECKER Clients ({len(active_cliquecheckers)})")

    if len(active_cliquecheckers) > 0:
        # Convert datetime columns to readable format
        if 'createdDate' in active_cliquecheckers.columns:
            active_cliquecheckers['createdDate'] = pd.to_datetime(active_cliquecheckers['createdDate']).dt.strftime('%Y-%m-%d %H:%M:%S')

        if 'lastPhoneHomeDate' in active_cliquecheckers.columns:
            active_cliquecheckers['lastPhoneHomeDate'] = pd.to_datetime(active_cliquecheckers['lastPhoneHomeDate']).dt.strftime('%Y-%m-%d %H:%M:%S')

            # Calculate time since last contact
            current_time = datetime.now()
            active_cliquecheckers['minutesSinceLastContact'] = (pd.to_datetime(current_time) - pd.to_datetime(active_cliquecheckers['lastPhoneHomeDate'])).dt.total_seconds() / 60
            active_cliquecheckers['timeSinceLastContact'] = active_cliquecheckers['minutesSinceLastContact'].apply(
                lambda x: f"{int(x // 60)}h {int(x % 60)}m ago"
            )

        # Reorder and select columns for display
        display_columns = ['clientId', 'campaignId', 'createdDate', 'lastPhoneHomeDate', 'timeSinceLastContact']
        display_columns = [col for col in display_columns if col in active_cliquecheckers.columns]

        # Display as table
        st.dataframe(active_cliquecheckers[display_columns], use_container_width=True)

        # Detailed cards for each active CLIQUECHECKER
        st.subheader("Active CLIQUECHECKER Details")

        # Create a container with max height and scrolling
        detail_container = st.container()

        with detail_container:
            for _, client in active_cliquecheckers.iterrows():
                with st.expander(f"Client ID: {client['clientId']}"):
                    col1, col2 = st.columns(2)

                    with col1:
                        st.write("**Basic Information**")
                        st.write(f"Client ID: {client['clientId']}")
                        st.write(f"Campaign ID: {client['campaignId']}")
                        st.write(f"Type: {client['type']}")
                        st.write(f"Status: {client['status']}")

                    with col2:
                        st.write("**Timing Information**")
                        if 'createdDate' in client:
                            st.write(f"Created: {client['createdDate']}")
                        if 'lastPhoneHomeDate' in client:
                            st.write(f"Last Contact: {client['lastPhoneHomeDate']}")
                            if 'timeSinceLastContact' in client:
                                st.write(f"Time Since Contact: {client['timeSinceLastContact']}")

                    # Fetch associated campaign if needed
                    campaign_id_raw = client['campaignId']
                    if campaign_id_raw is not None and not (isinstance(campaign_id_raw, float) and math.isnan(campaign_id_raw)):
                        campaign_id = str(int(campaign_id_raw))
                        if st.button(f"View Campaign Details (ID: {campaign_id})", key=f"campaign_{client['clientId']}"):
                            campaign = fetch_rest_api(api_base_url, f"/api/ramsey/campaigns/{campaign_id}")
                            if campaign:
                                st.json(campaign)
                            else:
                                st.warning("Could not fetch campaign details")

    else:
        st.info("No active CLIQUECHECKER clients found")

else:
    st.warning("No client data available. Please check your API connection.")

# Additional information and help
st.markdown("---")
with st.expander("How to use this dashboard"):
    st.write("""
    - This dashboard connects to your GraphQL API to show real-time work unit processing status
    - The progress is measured against the total of 427 million work units
    - The Client Analysis section shows the breakdown of clients by type and status
    - Details of Active CLIQUECHECKER clients are displayed with their last contact time
    - Click the 'Refresh Data' button to manually update the dashboard
    """)

with st.expander("API Details"):
    st.code(gql_query, language="graphql")
    st.write("REST API Endpoint: `/api/ramsey/clients`")