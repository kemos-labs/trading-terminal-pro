"""Shared path configuration.

All locations are overridable via environment variables so the pipeline can
run against any storage layout:

    BINANCE_DATA_DIR   raw zips + per-symbol parquet files (default: ./data)
    RESULTS_DIR        intermediate tables and text reports (default: ./results)
    FIGURES_DIR        output figures                        (default: ./figures)
"""
import os

DATA_DIR = os.environ.get("BINANCE_DATA_DIR", "data")
RESULTS_DIR = os.environ.get("RESULTS_DIR", "results")
FIGURES_DIR = os.environ.get("FIGURES_DIR", "figures")

for _d in (DATA_DIR, RESULTS_DIR, FIGURES_DIR):
    os.makedirs(_d, exist_ok=True)


def parquet_dir(interval: str) -> str:
    return os.path.join(DATA_DIR, f"parquet_{interval}")
