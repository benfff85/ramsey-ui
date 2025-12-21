# Ramsey UI

A Streamlit dashboard for visualizing clique count progression across stages in the Ramsey distributed computing system.

## Features

- **Clique Count Progression Chart**: Line graph showing how clique count decreases over stages
- **Improvement Metrics**: Current stage, clique count, total improvement
- **Per-Stage Improvement Bars**: Visualize how much each stage improved

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `API_BASE_URL` | Middleware API URL | `http://localhost:4040` |
| `RAMSEY_CAMPAIGN_ID` | Campaign ID to monitor | `1` |

## Running Locally

```bash
pip install -r requirements.txt
streamlit run app.py
```

## Docker

Build:
```bash
docker build -t benferenchak/ramsey-ui:develop .
```

Run:
```bash
docker run -p 8501:8501 -e API_BASE_URL=http://ramsey-mw:8080 benferenchak/ramsey-ui:develop
```

## Screenshot

The dashboard displays:
- Current stage number and clique count
- Total improvement from first to current stage
- Interactive line chart of progression
- Bar chart showing improvement per stage transition
