"""CLI: uv run python -m heatreuse.run -> outputs/site2.json, site1.json, offtakers.json, charts."""
from __future__ import annotations
import json
from . import config as C, model, report, scoring, charts
from .config import ROOT

OUT = ROOT / "outputs"


def _dump(obj, name):
    OUT.mkdir(exist_ok=True)
    (OUT / name).write_text(json.dumps(obj, indent=2, default=float), encoding="utf-8")


def main():
    cfg = C.load("site2")
    base = model.full(cfg)
    T = base["sim"]["T"]
    with_town = model.full(cfg, include_town=True, T=T)
    tor = model.tornado(cfg, T)
    scen = model.scenarios(cfg, T)
    cop = model.cop_compare(cfg, T)
    be = model.breakeven_homes(cfg, T)
    R = base["sim"]["rings"]
    model_mwh = dict(gh_onsite=float(R["onsite"]["comp"]["greenhouse"].sum()), aqua_onsite=float(R["onsite"]["comp"]["aquaculture"].sum()),
                     rec_onsite=float(R["onsite"]["comp"]["rec_pool"].sum()), corridor_homes=float(R["corridor"]["D"].sum()),
                     lansing_csd=cfg["eng"]["town"]["schools"]["floor_m2"] * cfg["eng"]["town"]["schools"]["kwh_m2"] / 1000)
    offt = scoring.build(cfg, model_mwh)
    s2 = report.build_site2(cfg, base, with_town, tor, scen, cop, offt, be)
    _dump(s2, "site2.json")
    _dump(offt, "offtakers.json")

    cfg1 = C.load("site1")
    b1 = model.full(cfg1)
    cop1 = model.cop_compare(cfg1, b1["sim"]["T"])
    f1, f2 = b1["fin"], base["fin"]
    i1, i2 = b1["imp"], base["imp"]
    co2_1, co2_2 = i1["co2_avoided_t_yr"] / f1["D"], i2["co2_avoided_t_yr"] / f2["D"]
    steam = f1["incumbents"].get("steam", 0)
    ratio = f1["lcoh"]["utility_7pct"] / steam if steam else float("nan")
    why = ("Site 1 is feasible but the weaker proposal for this challenge, and the numbers say so. "
           "(1) Cost: Manhattan LCOH is $%.0f/MWh against Con Ed steam at $%.0f/MWh, %.1fx the incumbent, so a 0.8x tariff cannot cover cost without large subsidy; Lansing blended phases 1-2 are $%.0f/MWh against propane-equivalent $%.0f/MWh. "
           "(2) Carbon: Site 1 avoids MORE CO2 per MWh delivered (%.3f vs %.3f t/MWh) because steam is a fossil incumbent, so carbon alone does not favour Lansing; Site 1 wins on tonnes per heat-MWh, loses on cost per tonne. "
           "(3) Source: legacy air-side cooling gives ~%d C capture; like-for-like COP %.1f vs %.1f for liquid cooling at Lansing, and a retrofit cannot specify the cooling architecture. "
           "(4) Competition: a Con Edison thermal-network pilot near the same NYCHA housing has been reported but is unverified; if confirmed, a second source would compete with the utility rather than fill a gap. "
           "(5) Leverage: Lansing is a new build with a live ban fight, so heat reuse is a decision-changing concession and liquid cooling can be specified from day one."
           % (f1["lcoh"]["utility_7pct"], steam, ratio, f2["lcoh"]["utility_7pct"], f2["incumbents"]["propane"], co2_1, co2_2,
              cfg1["eng"]["supply"]["capture_temp_c"], cop1["liquid"], cop["liquid"]))
    _dump(report.build_site1(cfg1, b1, cop1, why), "site1.json")
    charts.make(base, with_town, tor, cop, OUT / "charts")
    f, i, d = base["fin"], base["imp"], base["sim"]["disp"]
    print("Delivered GWh %.1f | LCOH 4/7/10: %s | propane %.0f oil %.0f | tariff %.0f | HH save vs propane $%.0f | CO2 %.0f t | capex $%.1fM | unmet h %d | town LCOH %.0f"
          % (f["D"] / 1000, {k: round(v) for k, v in f["lcoh"].items()}, f["incumbents"]["propane"], f["incumbents"]["heating_oil"], f["tariff"],
             f["household"]["savings_vs_propane_usd"], i["co2_avoided_t_yr"], f["capex_total"] / 1e6, (d["unmet"] > 1e-6).sum(), with_town["fin"]["lcoh_ring"]["town"]))
    e = s2["extras"]
    print("CBA", e["cba"]); print("corridor LCOH", f["lcoh_ring"], "breakeven", be)
    print("Site1 LCOH7 %.0f vs steam %.0f" % (f1["lcoh"]["utility_7pct"], f1["incumbents"].get("steam", 0)))


if __name__ == "__main__":
    main()
