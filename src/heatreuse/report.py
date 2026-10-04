"""Assemble contract JSON (docs/data-contract.md) from model results."""
from __future__ import annotations
import datetime as dt
import numpy as np
from . import weather, scoring, finance

SOURCES = [
    {"id": "nyserda_prop", "label": "NYSERDA heating oil / propane prices (propane base $3.10/gal is a model assumption; statewide $3.120/gal on 2026-09-21; oil $5.186 Central monthly avg)", "url": "https://www.nyserda.ny.gov/Energy-Prices/Home-Heating-Oil/Average-Home-Heating-Oil-Prices"},
    {"id": "epa_ef", "label": "EPA GHG Emission Factors Hub 2025 (propane 62.87, oil 73.96, gas 53.06 kg CO2/MMBtu; propane corrected per verification 10d)", "url": "https://www.epa.gov/climateleadership/ghg-emission-factors-hub"},
    {"id": "egrid", "label": "EPA eGRID2023 (NYUP 242.8 lb CO2e/MWh; NYCW 865.7)", "url": "https://www.epa.gov/egrid"},
    {"id": "rii", "label": "RII: Colocating Data Centers and Greenhouses, Virginia, June 2025 (1 MWth/ha, 2 acres/MW, jobs Table 2)", "url": "resources/text/Colocating-Data-Centers_Greenhouses-RII-Virginia.txt"},
    {"id": "cbs", "label": "CBS data center district heating white paper (10 MW HP ~EUR 6M, ~9 yr payback, connection cost vs distance p13,17,19)", "url": "resources/text/CBS_Data_center_white_paper_DISTRICT_HEATING.txt"},
    {"id": "ocp", "label": "OCP Data Centers Heat Reuse 101 (DLC return 45-65 C p6; cost split p7-8)", "url": "resources/text/20230623_Data_Centers_HeatReuse_101_3.2.docx.txt"},
    {"id": "t5", "label": "Topic 5 deck: heat pump COP 2-5, 4G networks 50-60 C", "url": "resources/text/Topic_5_-_Heat_reuse,_Connecting_DC_to_DE_systems_v5.txt"},
    {"id": "tmy", "label": "Climate.OneBuilding TMYx 2009-2023, Ithaca Tompkins Rgnl AP 725155 (hourly weather)", "url": "https://climate.onebuilding.org/WMO_Region_4_North_and_Central_America/USA_United_States_of_America/NY_New_York/USA_NY_Ithaca.Tompkins.Rgnl.AP.725155_TMYx.2009-2023.zip"},
    {"id": "eia_ind", "label": "EIA Electric Power Monthly Table 5.6.A: NY industrial 10.81 c/kWh, July 2026 (central heat pump rate)", "url": "https://www.eia.gov/electricity/monthly/epm_table_grapher.php?t=epmt_5_6_a"},
    {"id": "tt", "label": "Turner & Townsend Data Centre Construction Cost Index 2025 (US$6.6-13.3 per W; CBA benchmark)", "url": "https://reports.turnerandtownsend.com/data-centre-construction-cost-index-2025/"},
    {"id": "mit", "label": "MIT OCW res-env-007 lec07: networked geothermal ~$50k per residence, ~1/3 in-home", "url": "https://ocw.mit.edu/courses/res-env-007-geothermal-energy-networks-transforming-our-thermal-energy-system-january-iap-2025/mitres_env_007_lec07_3.pdf"},
    {"id": "ver_itc", "label": "verification.md rows 9d-i/9h: waste-heat networks likely not eligible for IRC 48 GHP credit (base case has no credit)", "url": "research/verification.md"},
    {"id": "ver_proj", "label": "verification.md rows 3a/3b: TeraWulf 400 MW gross / 320 MW critical IT, ops ~2029; row 6a gas moratorium Feb 2015", "url": "research/verification.md"},
    {"id": "ver_ef", "label": "verification.md rows 7a-7c, 10d: price and emission-factor corrections applied", "url": "research/verification.md"},
    {"id": "f2", "label": "Site 2 fact base (prices, climate, offtakers)", "url": "research/facts-site2.md"},
    {"id": "f1", "label": "Site 1 fact base (ConEd steam $41.53/Mlb, NYCHA units)", "url": "research/facts-site1.md"},
    {"id": "dig", "label": "Organizer digest (COP 2-6, ERF/ERE definitions HDR p17-18)", "url": "research/digest-organizer.md"},
    {"id": "notes", "label": "Model assumption log", "url": "research/model-notes.md"},
]


def _week(res, which):
    T, d = res["sim"]["T"], res["sim"]["disp"]
    wk = np.array([T[s:s + 168].mean() for s in range(0, 8760 - 168, 24)])
    s = int(np.argmin(wk) if which == "winter" else np.argmax(wk)) * 24
    sl = slice(s, s + 168)
    rows = []
    for i, t in enumerate(range(s, s + 168)):
        rows.append(dict(h=i, demand_MW=round(float(d["D"][t]), 3), delivered_MW=round(float(d["D"][t] * d["f"][t]), 3),
                         storage_MWh=round(float(d["soc"][t]), 2), backup_MW=round(float(d["D"][t] * (1 - d["f"][t])), 3),
                         outdoor_C=round(float(T[t]), 1)))
    return rows


def _monthly(res):
    m = weather.months()
    d, A = res["sim"]["disp"], res["sim"]["A"]
    rows = []
    for k in range(1, 13):
        i = m == k
        rows.append(dict(month=k, supply_MWh=round(float(A[i].sum()), 0), demand_MWh=round(float(d["D"][i].sum()), 0),
                         delivered_MWh=round(float((d["D"] * d["f"])[i].sum()), 0),
                         backup_MWh=round(float((d["D"] * (1 - d["f"]))[i].sum()), 0)))
    return rows


def _totals(res):
    d, R, fin = res["sim"]["disp"], res["sim"]["rings"], res["fin"]
    hp_heat = sum(float(((R[r]["D"] if r == "corridor" else R[r]["D"] + R[r]["L"]) * d["f"]).sum()) for r in d["active"] if r != "onsite")
    hp_el = float(d["e_served"].sum())
    G = sum(R[r]["D"] + R[r]["L"] for r in d["active"])
    k = max(int(round(0.01 * len(G))), 1)
    pk = np.argsort(G)[-k:]
    bk_pk = float(((G * (1 - d["f"]))[pk]).sum() / G[pk].sum())
    bk_yr = float(((G * (1 - d["f"]))).sum() / G.sum())
    return dict(heat_delivered_MWh=round(fin["D"], 0),
                peak_share_dc_pct=round(100 * (1 - bk_pk), 1), peak_share_backup_pct=round(100 * bk_pk, 1),
                backup_share_annual_pct=round(100 * bk_yr, 2), peak_hours_counted=k,
                unmet_note="unmet_hours is 0 by construction (backup boilers sized 100% of peak); read peak_share_* / backup_share_annual_pct for real resilience.", share_of_available_pct=round(100 * fin["D"] / float(res["sim"]["A"].sum()), 2),
                hp_elec_MWh=round(hp_el, 0), backup_MWh=round(float((d["D"] * (1 - d["f"])).sum()), 0),
                unmet_hours=int((d["unmet"] > 1e-6).sum()), avg_cop=round(hp_heat / hp_el, 2) if hp_el else 0,
                storage_m3=round(d["vol_m3"], 0))


def _supply(cfg, res):
    s, A = cfg["eng"]["supply"], res["sim"]["A"]
    return dict(it_load_MW=s["it_load_mw"], load_factor=s["load_factor"], capture_fraction=s["capture_fraction"],
                capture_temp_C=s["capture_temp_c"], heat_available_GWh=round(float(A.sum() / 1000), 1),
                heat_available_MW_avg=round(float(A.mean()), 1))


def _ring_stats(r):
    return round(float(r["D"].sum()), 0), round(float(r["D"].max()), 2)


def build_site2(cfg, base, with_town, tor, scen, cop, offt, be=None) -> dict:
    fin, imp, R = base["fin"], base["imp"], base["sim"]["rings"]
    inc = {k: round(v, 1) for k, v in fin["incumbents"].items() if not k.startswith("_")}
    on_mwh, on_pk = _ring_stats(R["onsite"])
    co_mwh, co_pk = _ring_stats(R["corridor"])
    tn_mwh, tn_pk = _ring_stats(R["town"])
    tfin = with_town["fin"]
    town_lcoh = tfin["lcoh_ring"]["town"]
    ref = fin["ref"]
    town_ok = town_lcoh <= 0.8 * ref
    co = R["corridor"]
    lin_density = co["D"].sum() / (co["pipe_km"] * 1000)
    gh_ha = cfg["eng"]["onsite"]["greenhouse"]["area_ha"]
    dc_capex = cfg["fin"]["cba"]["dc_capex_usd_per_mw_it"] * cfg["eng"]["supply"]["it_load_mw"]
    cba_gap = fin["corridor_gap_musd"]
    proj_gap = fin["funding_gap_musd"]
    out = dict(
        meta=dict(site=cfg["eng"]["site"]["name"], generated=dt.date.today().isoformat(), scenario="base",
                  weather=base["sim"]["weather_src"], scope="Phases 1-2 (on-site + corridor) in totals/finance; town ring reported separately (conditional)"),
        supply=_supply(cfg, base),
        rings=[
            dict(id="onsite", name="On-site agri & community campus", phase=1, users=["greenhouse", "aquaculture", "rec center + pool"],
                 annual_MWh=on_mwh, peak_MW=on_pk, supply_temp_C=cfg["eng"]["onsite"]["supply_temp_c"], pipe_km=cfg["eng"]["onsite"]["pipe_km"],
                 lcoh_usd_mwh_7pct=round(fin["lcoh_ring"]["onsite"], 1), direct_heat_exchange=True),
            dict(id="corridor", name="Corridor homes & farms (ambient loop)", phase=2, homes=int(co["units"]),
                 annual_MWh=co_mwh, peak_MW=co_pk, supply_temp_C=cfg["eng"]["corridor"]["supply_temp_c"], pipe_km=round(co["pipe_km"], 1),
                 lcoh_usd_mwh_7pct=round(fin["lcoh_ring"]["corridor"], 1), linear_heat_density_MWh_per_m=round(float(lin_density), 2),
                 building_hp_cop=round(float(co["D"].sum() / co["E"].sum()), 2)),
            dict(id="town", name="Town center: school campus + town buildings", phase=3, annual_MWh=tn_mwh, peak_MW=tn_pk,
                 supply_temp_C=cfg["eng"]["town"]["supply_temp_c"], pipe_km=round(R["town"]["pipe_km"], 1), conditional=True,
                 lcoh_usd_mwh_7pct=round(town_lcoh, 1), passes_gate=bool(town_ok),
                 pipe_loss_MWh=round(float(R["town"]["L"].sum()), 0), central_hp_cop=round(float((R["town"]["D"] + R["town"]["L"]).sum() / R["town"]["E"].sum()), 2)),
        ],
        totals=_totals(base),
        monthly=_monthly(base),
        weeks=dict(winter=_week(base, "winter"), summer=_week(base, "summer")),
        cop_compare=[dict(source="Air-cooled (30 °C)", cop=round(cop["air"], 2)), dict(source="Liquid-cooled (50 °C)", cop=round(cop["liquid"], 2))],
        finance=dict(
            capex_musd=dict(total=round(fin["capex_total"] / 1e6, 2),
                            lines=[dict(item=x["item"], musd=round(x["usd"] / 1e6, 2), source=x["source"]) for x in fin["lines"]]),
            opex_musd_yr=round(fin["opex_total"] / 1e6, 2),
            lcoh_usd_mwh={k: round(v, 1) for k, v in fin["lcoh"].items()},
            incumbent_usd_mwh=inc,
            tariff_usd_mwh=round(fin["tariff"], 1), low_income_tariff_usd_mwh=round(fin["li_tariff"], 1),
            elec_price_usd_mwh=dict(industrial=round(1000 * cfg["fin"]["elec_price_central_usd_kwh"]), residential=round(1000 * cfg["fin"]["elec_price_usd_kwh"])),
            tariff_rule="0.8 x propane, fixed",
            household=dict(typical_MWh_yr=fin["household"]["typical_MWh_yr"],
                           savings_vs_propane_usd=round(fin["household"]["savings_vs_propane_usd"], 0),
                           savings_vs_oil_usd=round(fin["household"]["savings_vs_oil_usd"], 0)),
            tornado=[dict(driver=t["driver"], low=round(t["low"], 1), high=round(t["high"], 1), base=round(t["base"], 1),
                          low_input=t["low_input"], high_input=t["high_input"], unit=t["unit"]) for t in tor],
            dc_exit=dict(year=fin["dc_exit"]["year"], stranded_musd=round(fin["dc_exit"]["stranded_musd"], 2),
                         replacement_source_musd=round(fin["dc_exit"]["replacement_source_musd"], 2),
                         corridor_cost_uplift_usd_mwh=round(fin["dc_exit"]["corridor_cost_uplift_usd_mwh"], 1),
                         fallback="Heat Supply Agreement with step-in rights and a decommissioning bond. Loop pipe and building heat pumps stay; "
                                  "central source swaps to air-source/borehole plant. Backup boilers cover hours until swap. "
                                  "On-site greenhouse/aquaculture revert to propane-equivalent or electric.")),
        impact=dict(co2_avoided_t_yr=round(imp["co2_avoided_t_yr"], 0), co2_cars_equiv=round(imp["cars"], 0), homes_served=int(co["units"]),
                    fossil_displaced_MWh=round(imp["fossil_displaced_MWh"], 0), erf=round(imp["erf"], 4),
                    water=dict(note="Closed-loop dry cooling is the water win and is TeraWulf's own design; heat reuse does not save lake water 1:1. "
                                    "Reuse shaves fan electricity and winter rejection load, and a covenant can keep the 1.008 MGD permit unused for cooling. "
                                    "No lake-water savings are claimed.",
                               fan_energy_saved_MWh=round(imp["fan_saved_mwh"], 0)),
                    jobs=round(imp["jobs"], 0), local_food_t_yr=round(imp["food_t"], 0), ere=round(imp["ere"], 3),
                    greenhouse_ha=gh_ha, fish_t_yr=cfg["eng"]["onsite"]["aquaculture"]["fish_t_yr"],
                    headline="A year-round %d-hectare farm and %d homes heated with data-center heat" % (gh_ha, co["units"])),
        value_by_stakeholder=[
            dict(who="Residents (corridor)", value="Heat priced %d%% under propane-equivalent, no gas needed" % round(100 * cfg["fin"]["tariff"]["discount_vs_propane"]),
                 metric="$%.0f/yr vs propane, $%.0f/yr vs oil (27 MWh home)" % (fin["household"]["savings_vs_propane_usd"], fin["household"]["savings_vs_oil_usd"])),
            dict(who="Low-income and older households", value="Extra %d%% tier discount" % round(100 * cfg["fin"]["tariff"]["low_income_discount"]),
                 metric="$%.0f/yr vs propane" % fin["household"]["savings_low_income_vs_propane_usd"]),
            dict(who="Town of Lansing", value="Binding Community Benefit + Heat Supply Agreement; jobs and local food", metric="%d jobs, %d t/yr food" % (imp["jobs"], imp["food_t"])),
            dict(who="Data center (TeraWulf)", value="Social license; ERF %.1f%%; fan energy avoided" % (100 * imp["erf"]), metric="%d MWh/yr fan energy" % imp["fan_saved_mwh"]),
            dict(who="Growers / aquaculture", value="Low-cost 45 C heat at the fence", metric="$%d/MWh vs propane $%d/MWh" % (cfg["fin"]["tariff"]["onsite_tariff_usd_mwh"], inc["propane"])),
            dict(who="Climate", value="CO2 avoided on a clean grid", metric="%d t/yr (%d with marginal grid)" % (imp["co2_avoided_t_yr"], imp["co2_avoided_marginal_grid_t_yr"])),
        ],
        hdr_scorecard=[
            dict(lens="Community", petal="Community", claim="Affordable heat for a town without gas", metric="$%.0f/yr per home" % fin["household"]["savings_vs_propane_usd"]),
            dict(lens="Community", petal="Human Health", claim="Replaces propane/oil combustion in homes", metric="%d MWh/yr fossil fuel displaced" % imp["fossil_displaced_MWh"]),
            dict(lens="Ecology", petal="Carbon", claim="Clean upstate grid lifts HP carbon benefit", metric="%d t CO2/yr avoided" % imp["co2_avoided_t_yr"]),
            dict(lens="Ecology", petal="Nutrients", claim="Closed-loop aquaponics instead of runoff to phosphorus-impaired Cayuga Lake", metric="Design intent; nutrient mass not yet quantified"),
            dict(lens="Ecology", petal="Water", claim="Closed-loop dry cooling stays; no lake-water claim", metric="0 gal/yr claimed; %d MWh/yr fan energy saved" % imp["fan_saved_mwh"]),
            dict(lens="Ecology", petal="Biodiversity", claim="Brownfield reuse; heat to controlled-environment agriculture", metric="%.0f ha greenhouse on former coal site" % cfg["eng"]["onsite"]["greenhouse"]["area_ha"]),
            dict(lens="Health", petal="Air", claim="Fewer combustion appliances in homes", metric="%d homes" % co["units"]),
        ],
        sources=SOURCES,
        extras=dict(
            scenarios=scen,
            with_town=dict(totals=_totals(with_town), lcoh_usd_mwh={k: round(v, 1) for k, v in tfin["lcoh"].items()},
                           capex_musd=round(tfin["capex_total"] / 1e6, 2), town_ring_lcoh_usd_mwh=round(town_lcoh, 1),
                           town_pipe_share_of_ring_capex=round(tfin.get("town_pipe_share_of_ring_capex", 0), 3),
                           verdict="PASSES gate (LCOH <= 80% of propane-equivalent)" if town_ok else "FAILS gate: long transmission main makes town-center heat dearer than propane; build only with grant funding or a larger anchor (e.g. Cargill mine)"),
            electricity_rates_usd_kwh=dict(central_hp_and_pumping_industrial=cfg["fin"]["elec_price_central_usd_kwh"], corridor_building_hps_residential=cfg["fin"]["elec_price_usd_kwh"],
                                           sources="EIA EPM Table 5.6.A NY industrial 10.81 c/kWh Jul 2026; NYSEG residential $0.245 (facts-site2 sec 4)"),
            cba=dict(headline_gap_musd=round(proj_gap, 2),
                     headline_annuitized_7pct_musd_per_yr=round(proj_gap * finance.crf(0.07, cfg["fin"]["years"]), 3),
                     headline_basis="ONE number: whole-project (phases 1-2) PV funding gap at 7%%, %d yr, separate asset lives. The on-site ring earns a surplus that cross-subsidises the corridor; the corridor stand-alone gap is the larger memo number below." % cfg["fin"]["years"],
                     corridor_standalone_gap_musd=round(cba_gap, 2),
                     reconciliation="Corridor stand-alone gap $%.1fM minus on-site surplus $%.1fM = whole-project gap $%.1fM. Quote the whole-project figure; the corridor-only figure applies if on-site customers are not served." % (cba_gap, cba_gap - proj_gap, proj_gap),
                     straight_line_undiscounted_per_year_musd=round(proj_gap / cfg["fin"]["years"], 3),
                     straight_line_note="Gap divided by %d years with no discounting; understates the true annual cost. Use the annuitized figure." % cfg["fin"]["years"],
                     corridor_gap_musd=round(cba_gap, 2), per_year_musd=round(cba_gap / cfg["fin"]["years"], 3),
                     per_year_annuitized_7pct_musd=round(cba_gap * finance.crf(0.07, cfg["fin"]["years"]), 3),
                     whole_project_gap_musd=round(proj_gap, 2), whole_project_per_year_musd=round(proj_gap / cfg["fin"]["years"], 3),
                     whole_project_per_year_annuitized_7pct_musd=round(proj_gap * finance.crf(0.07, cfg["fin"]["years"]), 3),
                     dc_capex_musd=round(dc_capex / 1e6, 0), as_pct_of_dc_capex=round(100 * cba_gap * 1e6 / dc_capex, 2),
                     whole_project_as_pct_of_dc_capex=round(100 * proj_gap * 1e6 / dc_capex, 2),
                     headline_as_pct_of_dc_capex=round(100 * proj_gap * 1e6 / dc_capex, 2),
                     dc_capex_basis="%.0f $M per MW IT x %d MW; Turner & Townsend Data Centre Construction Cost Index 2025 (US$6.6-13.3/W, ~$10/W midpoint assumed)" % (cfg["fin"]["cba"]["dc_capex_usd_per_mw_it"] / 1e6, cfg["eng"]["supply"]["it_load_mw"]),
                     breakeven_homes_if_cba_pays_pipe=be,
                     note="Corridor gap = PV shortfall of the corridor ring at the blended tariff (0.8x propane, 20% low-income tier), 7%, 30 yr."),
            lcoh_incentive_scenario_if_qualifies_usd_mwh=round(fin["lcoh_itc7"], 1),
            funding=dict(npv7_musd=round(fin["npv7"] / 1e6, 2), funding_gap_musd=round(fin["funding_gap_musd"], 2),
                         funding_gap_incentive_scenario_if_qualifies_musd=round(fin["funding_gap_itc_musd"], 2),
                         revenue_musd_yr=round(fin["revenue"] / 1e6, 2),
                         note="Gap = what grants, a Community Benefit contribution from the data center, or low-cost capital must cover so tariffs stay below incumbents. "
                              "Federal ITC for waste-heat networks is NOT assumed (research/verification.md 9d-i)."),
            tariff_scenarios=[{k: (round(v, 2) if isinstance(v, float) else v) for k, v in s.items()} for s in fin["tariff_scenarios"]],
            ring_lcoh_usd_mwh={k: round(v, 1) for k, v in fin["lcoh_ring"].items()},
            air_source_hp_seasonal_cop=round(fin["incumbents"]["_ashp_seasonal_cop"], 2),
            cop_design_60C_sink=dict(air=round(cop["air_design"], 2), liquid=round(cop["liquid_design"], 2)),
            linear_heat_density_corridor_MWh_per_m=round(float(lin_density), 2),
            cbs_checks=dict(town_distance_km=round(R["town"]["pipe_km"], 1), cbs_poor_distance_km=cfg["fin"]["reference_checks"]["cbs_poor_distance_km"],
                            note="CBS p13,19: connection cost share of capex rises from 3%% to 50%% between 50 m and 4 km; >2 km rated poor. Town ring is %.0f km." % R["town"]["pipe_km"]),
            greenhouse_check=dict(peak_MW=round(float(R["onsite"]["comp"]["greenhouse"].max()), 2), area_ha=cfg["eng"]["onsite"]["greenhouse"]["area_ha"],
                                  rii_benchmark="~1 MWth per ha (10 ha ~ 10 MW), ~2 acres/MW of DC load (RII p7, p34)"),
            co2_avoided_marginal_grid_t_yr=round(imp["co2_avoided_marginal_grid_t_yr"], 0),
            cost_split_rule="OCP p7-8: DC and host share extraction costs; host pays upgrading/storage/heat pumps.",
            offtakers_top=[o["name"] for o in offt[:5]],
            provenance=dict(
                supply_capture_fraction=dict(unit="fraction", source="ASSUMPTION; range 0.40 (RII 33-42%) to 0.85 (organizer deck)"),
                capture_temp_C=dict(unit="C", source="resources/text/Colocating-Data-Centers_Greenhouses-RII-Virginia.txt p10 (45-55 C DLC)"),
                incumbent_usd_mwh=dict(unit="$/MWh_th at appliance efficiency", source="research/facts-site2.md sec 4; research/verification.md 7a-7c"),
                co2_avoided_t_yr=dict(unit="t CO2/yr", source="model; EF research/facts-site2.md sec 7 with propane corrected per verification.md 10d"),
                lcoh_usd_mwh=dict(unit="$/MWh_th delivered", source="model; assumptions in research/model-notes.md"),
            ),
        ),
    )
    return out


def build_site1(cfg, base, cop, why) -> dict:
    fin, imp = base["fin"], base["imp"]
    inc = {k: round(v, 1) for k, v in fin["incumbents"].items() if not k.startswith("_")}
    return dict(
        meta=dict(site=cfg["eng"]["site"]["name"], generated=dt.date.today().isoformat(), scenario="comparison", weather=base["sim"]["weather_src"]),
        supply=_supply(cfg, base),
        totals=_totals(base),
        finance=dict(capex_musd=dict(total=round(fin["capex_total"] / 1e6, 2)), opex_musd_yr=round(fin["opex_total"] / 1e6, 2),
                     lcoh_usd_mwh={k: round(v, 1) for k, v in fin["lcoh"].items()}, incumbent_usd_mwh=inc,
                     tariff_usd_mwh=round(fin["tariff"], 1),
                     elec_price_usd_mwh=dict(industrial=round(1000 * cfg["fin"]["elec_price_central_usd_kwh"]), residential=round(1000 * cfg["fin"]["elec_price_usd_kwh"])),
                     tariff_rule="0.8 x propane-equivalent (Site 1 reference: Con Ed steam), fixed", ring_lcoh_usd_mwh={k: round(v, 1) for k, v in fin["lcoh_ring"].items()},
                     reference=fin["ref_name"]),
        impact=dict(co2_avoided_t_yr=round(imp["co2_avoided_t_yr"], 0), co2_cars_equiv=round(imp["cars"], 0),
                    homes_served=int(base["sim"]["rings"]["corridor"]["units"]), fossil_displaced_MWh=round(imp["fossil_displaced_MWh"], 0),
                    erf=round(imp["erf"], 4)),
        cop_compare=[dict(source="Condenser loop (32 C)", cop=round(cop["liquid"], 2))],
        why_not_chosen=why,
        sources=SOURCES,
    )
