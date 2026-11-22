import sys, os
here = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(here, "..", "..", "server")))
import engine
print("ENGINE_FILE", engine.__file__)
days = [{"date": "2026-01-01", "balance": 100.0, "inflow": 0.0}, {"date": "2026-01-02", "balance": -20.0, "inflow": 50.0}]
print("DETECT_CRUNCH_KEYS", sorted(engine.detect_crunch(days, 10.0).keys()))
