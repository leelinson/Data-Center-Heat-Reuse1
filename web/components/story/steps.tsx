"use client";
import type { ReactNode } from "react";
import type { AppData } from "@/lib/types";
import { dec, int, usd } from "@/lib/format";
import { RingMap } from "../viz/RingMap";
import { Sankey } from "../viz/Sankey";
import { HouseholdCalc, QrCode, RatioBars, TempLadder } from "../viz/Misc";
import { LcohBars, MonthlyChart, RingLcoh, WeekChart } from "../viz/Charts";
import { RingDot, ringColor, ringText, ringShort } from "../ui";
import { CREDITS, PUBLIC_URL } from "@/lib/config";

export interface Step {
  id: string;
  kicker: string;
  headline: ReactNode;
  lede?: ReactNode;
  layout: "split" | "wide";
  visualWide?: boolean;
  visual?: ReactNode;
  /** Replaces the whole screen (own headline). */
  full?: ReactNode;
  notes: string;
  /** Deep-dive steps are skipped on the 5-minute path. */
  deepDive?: boolean;
}

function Tile({ big, unit, label, tone }: { big: string; unit?: string; label: ReactNode; tone?: "ember" | "teal" | "violet" }) {
  const c = tone === "teal" ? "var(--teal-text)" : tone === "violet" ? "var(--violet-text)" : "var(--ember-text)";
  return (
    <div className="card p-4">
      <div className="serif num font-bold leading-none whitespace-nowrap" style={{ color: c, fontSize: "clamp(2rem,3.2vw,3.25rem)" }}>{big}{unit && <span className="unit">{unit}</span>}</div>
      <div className="mt-1.5 text-[1.0625rem] text-ink leading-snug">{label}</div>
    </div>
  );
}

function Pill({ n, title, children, tone }: { n?: string; title: string; children: ReactNode; tone?: string }) {
  return (
    <div className="card p-4 h-full">
      <div className="font-bold text-[1.125rem]" style={{ color: tone ?? "var(--ink)" }}>{n && <span className="num mr-1">{n}</span>}{title}</div>
      <div className="text-[1.0625rem] text-ink2 leading-snug mt-1">{children}</div>
    </div>
  );
}

export function buildSteps(data: AppData): Step[] {
  const d = data.site2;
  const f = d.finance;
  const T = d.totals;
  const availMWh = d.supply.heat_available_GWh * 1000;
  const incl = d.rings.filter((r) => !r.conditional);
  const demandAll = T.heat_delivered_MWh; // Phases 1-2, as modelled
  const ratio = availMWh / demandAll;
  const sharePct = T.share_of_available_pct;
  const ex = d.extras;
  const ha = ex?.greenhouse_check?.area_ha;
  const corridor = d.rings.find((r) => r.id === "corridor");
  const homes = corridor?.homes ?? d.impact.homes_served;
  const minMonthRatio = Math.min(...d.monthly.map((m) => m.supply_MWh / m.demand_MWh));
  const peakMonth = Math.max(...d.monthly.map((m) => m.demand_MWh));
  const lowMonth = Math.min(...d.monthly.map((m) => m.demand_MWh));
  const totalPeak = incl.reduce((s, r) => s + r.peak_MW, 0);
  const storageMWh = (d.totals.storage_m3 * 1.163 * 20) / 1000; // water: 1.163 kWh/m3/K, 20 K swing (model config)
  const storageHours = storageMWh / totalPeak;
  const allBeatOil = f.lcoh_usd_mwh.private_10pct < Math.min(f.incumbent_usd_mwh.propane, f.incumbent_usd_mwh.heating_oil);
  const ringL: Partial<Record<string, number>> = { ...(ex?.ring_lcoh_usd_mwh ?? {}) };
  for (const r of d.rings) if (r.lcoh_usd_mwh_7pct !== undefined) ringL[r.id] = r.lcoh_usd_mwh_7pct;
  const fund = ex?.funding;
  const cba = ex?.cba;
  const backupPct = (T.backup_MWh / T.heat_delivered_MWh) * 100;
  const cleanCarbonCars = d.impact.co2_cars_equiv;

  return [
    {
      id: "fight",
      kicker: "1 · Lansing today",
      headline: "Lansing is about to ban data centers, and most of its heat still comes from delivered fuel",
      lede: "Heat reuse alone did not save a data center in Lansing, Michigan: Deep Green withdrew its proposal in April 2026. Lansing, New York needs ownership, guarantees and proof.",
      layout: "split",
      notes: "Open with the fight, not the technology. Precedent, Lansing, Michigan, not Lansing, New York: Deep Green's 24 MW proposal (more than $120 million) would have sent heat to the city utility's downtown hot-water system. Deep Green withdrew the rezoning application on April 6, 2026, and it is not proceeding. Heat reuse without ownership and a binding contract is not a plan; ownership, a binding agreement and public metering are. On Sept 29, 2026 the Town Board directed its attorney to draft a data-center ban and set aside $500,000 in next year's proposed budget for legal costs. Meanwhile NYSEG invoked a gas moratorium here in February 2015, still described as in effect in a July 2025 filing, so many homes burn propane or oil. Frame: we are not defending the project, we are offering the conditions under which Lansing could say yes.",
      visual: (
        <div className="grid gap-4">
          <Tile big="Sept 29" label="2026: the Town Board directed its attorney to draft a data-center ban, and set aside $500,000 in next year's proposed budget for legal costs" />
          <Tile tone="teal" big="2015" label="year the NYSEG gas moratorium began; still in effect per a July 2025 filing. Many rural homes burn propane or oil." />
          <Tile big={`$${int(f.incumbent_usd_mwh.propane)}`} unit="per MWh" label={<>what a propane home pays for each MWh of heat (model base $3.10 per gallon; NYSERDA statewide average was $3.12 on Sept 21, 2026). Heating oil: <b className="num">${int(f.incumbent_usd_mwh.heating_oil)}</b>.</>} />
        </div>
      ),
    },
    {
      id: "insight",
      kicker: "2 · The insight",
      headline: <>The data center makes <span className="text-ember-text num">{dec(ratio, 0)}&times;</span> more heat than we use: only <span className="text-ember-text num">{dec(sharePct, 1)}%</span> is needed</>,
      lede: <>Our base case is a {int(d.supply.it_load_MW)} MW first phase; about {int(d.supply.capture_fraction * 100)}% of its power can be captured as {d.supply.capture_temp_C} °C heat. Supply is not the constraint. Matching it to users is.</>,
      layout: "split",
      notes: "This is the whole thesis. Supply is effectively unlimited: demand is the constraint, so we design from the user side. Our base case is a 150 MW first phase. TeraWulf's filing is larger (400 MW gross, 320 MW critical IT, operations around 2029), which only widens the gap. Heat is only waste if we choose to waste it.",
      visual: <RatioBars d={d} />,
    },
    {
      id: "plan",
      kicker: "3 · The plan",
      headline: `A data center's heat could warm a ${ha ? `${int(ha)}-hectare ` : ""}year-round farm campus and ${int(homes)} homes`,
      lede: "Bring the users to the heat. Start next to the data center (a proposed campus on adjacent land), then follow the road toward town, and reach the town center only if the numbers pass.",
      layout: "split",
      notes: "Three rings. Ring 1, Phase 1 (proposed): on-site greenhouse, aquaculture and a community rec center with pool on adjacent land. The 183-acre site is on an 80-year lease to TeraWulf's Lake Hawkeye LLC and the landlord is an affiliate, so the campus is framed as proposed. It is a year-round sink with no public trenching. Ring 2: homes and farms along the road on an ambient loop, gated by sign-up density. Ring 3: school campus and town buildings, 5-7 miles away, built only if its cost of heat beats propane and oil.",
      visual: (
        <div className="flex flex-col gap-4 h-full min-h-0">
          <div className="h-[min(44dvh,420px)] lg:h-auto lg:flex-1 min-h-[260px]"><RingMap offtakers={data.offtakers} /></div>
          <ul className="grid gap-2 list-none p-0 m-0 sm:grid-cols-3">
            {d.rings.map((r) => (
              <li key={r.id} className="card p-3">
                <div className="font-bold text-[1.0625rem]" style={{ color: ringText(r.id) }}><RingDot ring={r.id} />Phase {r.phase}: {ringShort(r.id)}{r.conditional ? " (if it pays)" : ""}</div>
                <div className="num text-[1.0625rem]">{dec(r.annual_MWh / 1000, 1)} GWh/yr · {dec(r.peak_MW, 0)} MW peak</div>
              </li>
            ))}
          </ul>
        </div>
      ),
    },
    {
      id: "flow",
      visualWide: true,
      kicker: "4 · How heat flows",
      headline: "Heat export is a side-stream: the data center never depends on us to stay cool",
      lede: <>A heat exchanger takes heat from the sealed cooling loop; heat pumps lift it where needed. The dry coolers keep working exactly as designed.</>,
      layout: "split",
      notes: "Cooling reliability is the hard constraint. The data center rejects 100% of its heat through its own dry coolers whether or not anyone takes heat. We tap a side-stream off the closed glycol loop, so a failure on our side cannot starve the servers. Heat pumps are the only extra electricity: shown in amber.",
      visual: <div className="h-full min-h-[300px]"><Sankey d={d} /></div>,
    },
    {
      id: "ladder",
      visualWide: true,
      kicker: "5 · Temperature ladder",
      headline: `Liquid cooling hands over ${d.supply.capture_temp_C} °C heat: greenhouses take it directly, buildings get a small boost`,
      lede: <>Average heat-pump COP across the network is <b className="num">{dec(T.avg_cop, 1)}</b>: one unit of electricity moves about {dec(T.avg_cop, 1)} units of heat.</>,
      layout: "split",
      deepDive: true,
      notes: "Temperature match. Air-cooled data centers hand over about 30 °C heat, which needs a big lift. Direct liquid cooling returns about 50 °C, so the greenhouse and aquaculture sit at or below source temperature and need no heat pump. Homes need the loop plus a building heat pump; town buildings need a 55-65 °C hot loop. Show the COP comparison between air and liquid.",
      visual: (
        <div className="grid gap-3 h-full min-h-0">
          <div className="min-h-[360px]"><TempLadder data={data} /></div>
          <ul className="flex flex-wrap gap-x-6 gap-y-1 list-none p-0 m-0 text-[1.0625rem]">
            {d.cop_compare.map((c) => (<li key={c.source}><b>{c.source}</b>: heat pump COP <b className="num text-teal-text">{dec(c.cop, 1)}</b></li>))}
          </ul>
        </div>
      ),
    },
    {
      id: "match",
      kicker: "6 · Matching through the year",
      headline: `Even in the leanest month, the data center makes ${dec(minMonthRatio, 1)}× the heat the network needs`,
      layout: "wide",
      notes: "Five axes of the match, left to right. Temperature: direct or lifted. Capacity: supply is many times demand. Timing: the winter week chart shows daily peaks smoothed by storage. Seasonality: monthly bars show demand falling in summer while the on-site greenhouse, aquaculture and pool keep a year-round base. Continuity: backup covers the remainder, zero unmet hours.",
      visual: (
        <div className="grid gap-4 h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
          <ul className="grid gap-3 grid-cols-2 lg:grid-cols-5 list-none p-0 m-0">
            <li><Pill n="1" title="Temperature" tone="var(--ember-text)">{d.supply.capture_temp_C} °C capture. On-site direct; homes and town via heat pumps, COP {dec(T.avg_cop, 1)}.</Pill></li>
            <li><Pill n="2" title="Capacity" tone="var(--ember-text)">{dec(ratio, 0)}× more heat than the {dec(demandAll / 1000, 0)} GWh/yr demand.</Pill></li>
            <li><Pill n="3" title="Timing" tone="var(--ember-text)">Storage ({int(T.storage_m3)} m³, about {dec(storageHours, 0)} h of peak) smooths daily peaks.</Pill></li>
            <li><Pill n="4" title="Seasonality" tone="var(--ember-text)">Summer demand is {int((lowMonth / peakMonth) * 100)}% of January; on-site users keep the base load.</Pill></li>
            <li><Pill n="5" title="Continuity" tone="var(--ember-text)">{int(T.unmet_hours)} unmet hours; backup supplies {dec(backupPct, 1)}% of heat.</Pill></li>
          </ul>
          <div className="grid gap-5 lg:grid-cols-2 min-h-0">
            <div className="min-h-[280px]"><MonthlyChart d={d} /></div>
            <div className="min-h-[280px]"><WeekChart d={d} /></div>
          </div>
        </div>
      ),
    },
    {
      id: "household",
      kicker: "7 · Your household",
      headline: "",
      layout: "wide",
      deepDive: true,
      notes: "Let someone in the room pick their own fuel. Propane and oil homes save the most; natural gas homes would not save, which is why this is aimed at the homes gas never reached. The tariff is set about 20% below propane; there is a low-income tier. Be honest about gas.",
      full: <HouseholdCalc d={d} />,
    },
    {
      id: "own",
      visualWide: false,
      kicker: "8 · Who pays, who owns",
      headline: ringL.onsite !== undefined ? "The right tool at every density: the farm first, a loop where homes cluster, rebates for the rest" : allBeatOil ? "Heat from the data center beats propane and oil under every ownership model; community ownership is cheapest" : `Community ownership cuts the cost of heat from $${int(f.lcoh_usd_mwh.private_10pct)} to $${int(f.lcoh_usd_mwh.coop_4pct)} per MWh`,
      layout: "wide",
      notes: "A community thermal utility, the Thermal Commons co-op, owns the pipes and heat pumps; the data center sells heat under a Heat Supply Agreement. Cheaper money is the biggest lever: public 4% finance vs private 10%. Be transparent that natural gas elsewhere is cheaper, but there are no new gas hookups in Lansing. Federal tax credits may apply if the project is structured to qualify, and NYSERDA programs may help; neither is in the base case.",
      visual: (
        <div className="grid gap-4 min-h-0">
          <div className="grid grid-cols-[1fr_auto_1.2fr_auto_1fr] items-stretch gap-2 text-center">
            <div className="card p-2"><b>Data center</b><div className="text-[1rem] text-ink2">sells heat, keeps cooling independent</div></div>
            <div aria-hidden className="self-center text-[1.75rem] text-ember">&rarr;</div>
            <div className="card p-2" style={{ borderColor: "var(--teal)", borderWidth: 2 }}><b>Thermal Commons co-op</b><div className="text-[1rem] text-ink2">owns pipes + heat pumps · ${int(f.capex_musd.total)}M capex · public finance</div></div>
            <div aria-hidden className="self-center text-[1.75rem] text-ember">&rarr;</div>
            <div className="card p-2"><b>Homes, farms, school</b><div className="text-[1rem] text-ink2">pay ${int(f.tariff_usd_mwh)} per MWh · low-income ${int(f.low_income_tariff_usd_mwh)}</div></div>
          </div>
          {ringL.onsite !== undefined ? (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] min-h-0">
              <div className="min-h-[260px]"><RingLcoh d={d} ringL={ringL} /></div>
              <div className="card p-3 text-[1.0625rem] leading-snug grid gap-1.5 content-start">
                <div className="font-bold text-[1.125rem]">Three tools, one benefit fund</div>
                <ol className="m-0 pl-5 grid gap-1">
                  <li><b>On-site campus:</b> data-center heat at <b className="num">${dec(ringL.onsite ?? 0, 0)}</b> per MWh, cheaper than anything else.</li>
                  <li><b>Clustered homes:</b> join a shared ambient loop where the numbers pass.</li>
                  <li><b>Scattered homes:</b> heat-pump rebates from the same fund, no pipe.</li>
                </ol>
                
                {fund?.funding_gap_musd !== undefined && <div>Gap a benefit fund, grants or cheap capital must cover: <b className="num text-ember-text">${dec(fund.funding_gap_musd, 1)}M</b>{fund.funding_gap_incentive_scenario_if_qualifies_musd !== undefined && <> (<span className="num">${dec(fund.funding_gap_incentive_scenario_if_qualifies_musd, 1)}M</span> if federal credits qualify)</>}.</div>}
                {cba?.as_pct_of_dc_capex !== undefined && <div>Community Benefit Agreement: about <b className="num text-teal-text">{dec(cba.as_pct_of_dc_capex, 1)}%</b> of the data center build{cba.per_year_annuitized_7pct_musd !== undefined && <>, <span className="num">${dec(cba.per_year_annuitized_7pct_musd, 2)}M</span> a year (annuitized at 7% over 30 years)</>}, funds the home program.</div>}
              </div>
            </div>
          ) : (
            <div className="min-h-[300px]"><LcohBars d={d} /></div>
          )}
        </div>
      ),
    },
    {
      id: "exit",
      kicker: "9 · What if the data center leaves?",
      headline: `If the data center leaves in year ${f.dc_exit.year}, the heat keeps flowing and the town is not left holding the bill`,
      layout: "wide",
      notes: "Data centers rarely sign beyond about 10 years, so we answer this before the Q&A does. Three layers: thermal storage rides through the first hours; backup boilers sized to 100% of peak cover days; step-in rights let the utility keep the loop. The stranded-asset exposure is covered by a decommissioning reserve funded from the Heat Supply Agreement, so the risk sits with the party that controls it.",
      visual: (
        <div className="grid gap-4 md:grid-cols-4">
          {[
            { t: "First hours", h: "Storage carries the load", b: `${int(d.totals.storage_m3)} m³ of hot water holds about ${dec(storageHours, 0)} hours of peak demand.` },
            { t: "Days", h: "Backup boilers take over", b: `Sized for 100% of ${dec(totalPeak, 0)} MW peak. Today they cover ${dec(backupPct, 1)}% of annual heat.` },
            { t: "Months", h: "Step-in rights", b: f.dc_exit.corridor_cost_uplift_usd_mwh !== undefined ? `The utility keeps the loop. Without the data center, corridor heat costs about $${int(f.dc_exit.corridor_cost_uplift_usd_mwh)} more per MWh${f.dc_exit.replacement_source_musd !== undefined ? `; a replacement source is about $${dec(f.dc_exit.replacement_source_musd, 0)}M` : ""}.` : "The utility can keep running the loop. Fallback: " + f.dc_exit.fallback },
            { t: `Year ${f.dc_exit.year}`, h: "Reserve covers the stranded asset", b: `Exposure of about $${dec(f.dc_exit.stranded_musd, 0)}M is covered by a decommissioning reserve in the Heat Supply Agreement.` },
          ].map((s, i) => (
            <div key={s.t} className="card p-5 relative">
              <div className="kicker">{s.t}</div>
              <div className="serif font-bold text-[1.5rem] leading-tight mt-1">{s.h}</div>
              <p className="text-ink2 mt-2 mb-0 text-[1.0625rem]">{s.b}</p>
              {i < 3 && <span aria-hidden className="hidden md:block absolute -right-4 top-1/2 text-[1.75rem] text-ember z-10">&rarr;</span>}
            </div>
          ))}
          <p className="md:col-span-4 m-0 text-[1.125rem] text-ink2">The data center&rsquo;s own cooling never depended on this network, so its exit is a heat-supply problem, not a safety problem.</p>
        </div>
      ),
    },
    {
      id: "impact",
      kicker: "10 · Impact",
      headline: `Every year: ${int(d.impact.co2_avoided_t_yr)} tonnes of CO₂ avoided, ${int(d.impact.jobs)} local jobs, ${int(d.impact.local_food_t_yr)} tonnes of local food`,
      layout: "wide",
      notes: "Map it to the four judging lenses and HDR's seven regenerative domains. Technical and economic were covered in steps 4 to 8. Environmental: CO2 avoided is displaced fuel minus heat-pump electricity at the upstate grid factor. Social and regenerative: Lansing has no designated disadvantaged community, so equity here means older residents and propane and oil households. Lake: closed-loop aquaponics keeps phosphorus out of an already phosphorus-impaired Cayuga Lake.",
      visual: (
        <div className="grid gap-4 min-h-0">
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <Tile tone="teal" big={int(d.impact.co2_avoided_t_yr)} unit="t CO₂/yr" label={<>about {int(cleanCarbonCars)} cars off the road</>} />
            <Tile big={int(d.impact.homes_served)} unit="homes" label="on recovered heat" />
            <Tile tone="violet" big={int(d.impact.jobs)} unit="jobs" label="on the on-site campus" />
            <Tile big={int(d.impact.local_food_t_yr)} unit="t food/yr" label="grown with heat, in winter too" />
          </div>
          <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-4">
            {d.hdr_scorecard.map((s) => (
              <div key={s.petal} className="card p-2.5">
                <div className="flex items-center gap-2 font-bold text-[1.0625rem]">
                  <span className="chip !py-0.5 !px-2.5 !text-[0.9375rem]" style={{ borderColor: s.lens === "Community" ? "var(--violet)" : s.lens === "Health" ? "var(--ember)" : "var(--teal)" }}>{s.lens}</span>
                  {s.petal}
                </div>
                <div className="text-[1.0625rem] text-ink2 leading-snug mt-1">{s.claim}</div>
              </div>
            ))}
            <div className="card p-3" style={{ background: "var(--surface2)" }}>
              <div className="font-bold text-[1.0625rem]">Lansing context</div>
              <div className="text-[1rem] text-ink2 leading-snug mt-1">No designated disadvantaged community: equity here means older residents and propane and oil households. Energy reuse factor (ERF) <span className="num">{dec(d.impact.erf, 3)}</span>{d.impact.ere !== undefined && <>, ERE <span className="num">{dec(d.impact.ere, 2)}</span></>}. Up to 69 days above 90 °F by 2050 (19 today).</div>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "ask",
      kicker: "11 · The ask",
      headline: cba?.as_pct_of_dc_capex !== undefined ? `Say yes with conditions: a Community Benefit Agreement worth ${dec(cba.as_pct_of_dc_capex, 1)}% of the build` : "Say yes with conditions: write heat reuse into a binding Community Benefit and Heat Supply Agreement",
      layout: "split",
      notes: "Close on three asks. Town: make heat reuse a condition of any approval. TeraWulf: sign the Heat Supply Agreement, keep cooling independent, keep the 1 MGD lake permit unused for cooling. Funders: NYSERDA FlexTech and large-scale thermal programs to pay for the feasibility work. Point to the QR code for the live model.",
      visual: (
        <div className="grid gap-4">
          {[
            { who: "Town of Lansing", what: cba?.as_pct_of_dc_capex !== undefined ? `Make a binding Community Benefit Agreement (about ${dec(cba.as_pct_of_dc_capex, 1)}% of the data center build, funding the home program) and a Heat Supply Agreement a condition of approval, instead of a flat ban.` : "Make a Heat Supply Agreement a condition of any approval, instead of a flat ban." },
            { who: "The data center", what: "Sign it: sell heat, keep cooling independent, keep the lake permit unused for cooling, fund the exit reserve." },
            { who: "Funders and state", what: "Co-fund the feasibility study and the Phase 1 on-site campus (NYSERDA programs; federal tax credits may apply if structured to qualify)." },
          ].map((a, i) => (
            <div key={a.who} className="card p-4 flex gap-4 items-start">
              <div className="serif num font-bold text-[2.5rem] leading-none text-ember-text">{i + 1}</div>
              <div><div className="font-bold text-[1.25rem]">{a.who}</div><div className="text-ink2 text-[1.125rem] leading-snug">{a.what}</div></div>
            </div>
          ))}
          <div className="flex items-center gap-5 card p-4">
            <QrCode url={PUBLIC_URL} size={110} hideCaption />
            <div className="text-[1.125rem]"><b>Try the model yourself.</b><div className="text-ink2">Move the sliders in Explore mode and watch the cost of heat change.</div><div className="text-[1rem] text-ink2 break-all mt-1">{PUBLIC_URL}</div></div>
          </div>
          <p className="m-0 text-[0.9375rem] text-ink2 leading-snug">{CREDITS}</p>
        </div>
      ),
    },
  ];
}
