PY := python3
export BINANCE_DATA_DIR ?= data

.PHONY: all data data-1m trades report clean

all: trades report

data:
	$(PY) scripts/build_manifest.py --interval 1h --start 2020-01
	$(PY) scripts/download.py $(BINANCE_DATA_DIR)/manifest_1h.txt
	$(PY) scripts/parse_klines.py 1h

data-1m:
	$(PY) scripts/build_manifest.py --interval 1m --start 2026-01
	$(PY) scripts/download.py $(BINANCE_DATA_DIR)/manifest_1m.txt
	$(PY) scripts/parse_klines.py 1m

trades:
	$(PY) scripts/build_trades.py

report:
	$(PY) scripts/claims_analysis.py
	$(PY) scripts/reconstruction.py
	$(PY) scripts/event_study.py
	$(PY) scripts/capital_report.py
	$(PY) scripts/tail_risk.py
	$(PY) scripts/placebo_test.py
	$(PY) scripts/funding_analysis.py
	$(PY) scripts/path_stats.py
	$(PY) scripts/walkforward.py
	$(PY) scripts/tail_mitigation.py

clean:
	rm -rf results figures/*.png
