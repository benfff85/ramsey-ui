# Ramsey UI

A Streamlit-based dashboard for real-time monitoring and management of work unit processing and campaign data in the Ramsey system.

## Features
- Visualizes work unit processing status with charts and progress indicators
- Displays client and campaign details with quick REST API integration
- Interactive controls for fetching and viewing campaign data
- Error handling and user-friendly warnings

## Requirements
- Python 3.8+
- [Streamlit](https://streamlit.io/)
- requests
- pandas
- altair
- plotly

## Installation

### Using Conda Environment (Recommended)
1. Create and activate the `ramsey-ui` conda environment:
   ```bash
   conda create -n ramsey-ui python=3.11 -y
   conda activate ramsey-ui
   ```
2. Install dependencies from `requirements.txt`:
   ```bash
   pip install -r requirements.txt
   ```

### Using pip Only
1. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

## Usage
1. Set your API base URL in the `app.py` file if needed.
2. Run the Streamlit app:
   ```bash
   streamlit run ramsey-ui/app.py
   ```
3. Open the provided local URL in your browser to access the dashboard.

## Notes
- Ensure the backend REST API is running and accessible from the machine running this UI.
- Campaign detail fetching expects campaign IDs to be integers (not floats like `1.0`).

## Project Structure
```
ramsey-ui/
  └── app.py
```

## License
MIT License
