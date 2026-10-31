/*
 * One crash's deep dive: the crash, each vehicle with the people in it,
 * pedestrians, cyclists and riders listed on their own, and the people on
 * the report who weren't in the crash (registered owners, witnesses).
 * Browser-safe; GET /api/crashes/:id returns this.
 *
 * Two parts per item, in the order the page shows them:
 *   recognize  what helps someone tell whether this is the crash they mean
 *   details    what happened (injuries, factors, damage), behind a toggle
 * null means not recorded; the page writes "Not recorded".
 */
import { DATASETS, sourceUrl } from "./config.js";
import { ROLE_LABELS, timeLabel, positionLabel } from "./normalize.js";
import { vehicleSummary, vehicleTypeName, makeName, locationLine, areaLine } from "./present.js";
import { prettyStreet } from "../complaints311/location-input.js";
import { boroughLabel } from "../complaints311/config.js";

const parse = (json) => {
  try { return json ? JSON.parse(json).filter((x) => x != null) : []; } catch { return []; }
};
const street = (s) => (s ? prettyStreet(s) : null);
const OUTSIDE_ROLES = new Set(["pedestrian", "cyclist", "other-motorized"]);

function personOut(p, vehicleLabels) {
  return {
    ref: p.unique_id,
    role: p.role,
    roleLabel: ROLE_LABELS[p.role] ?? p.ped_role ?? null,
    recognize: {
      age: p.age,
      sex: p.sex === "M" ? "Male" : p.sex === "F" ? "Female" : null,
      vehicle: p.vehicle_ref ? vehicleLabels.get(p.vehicle_ref) ?? null : null,
      position: p.position_key ? positionLabel(p.position_key) : p.position
    },
    details: {
      injury: p.injury ?? (p.involved ? "No injury recorded" : null),
      bodilyInjury: p.bodily_injury,
      complaint: p.complaint,
      ejection: p.ejection,
      safetyEquipment: p.safety_equipment,
      emotionalStatus: p.emotional_status,
      pedLocation: p.ped_location,
      pedAction: p.ped_action,
      factors: parse(p.factors)
    }
  };
}

export function crashDetail({ crash, vehicles = [], persons = [] }) {
  const vehicleLabels = new Map(vehicles.map((v, i) => [v.unique_id, `Vehicle ${i + 1}: ${vehicleSummary(v)}`]));
  const occupants = new Map(vehicles.map((v) => [v.unique_id, []]));
  const outside = [], notInvolved = [], unplaced = [];

  for (const p of persons) {
    const out = personOut(p, vehicleLabels);
    if (!p.involved) notInvolved.push(out);
    else if (OUTSIDE_ROLES.has(p.role)) outside.push(out);
    else if (p.vehicle_ref && occupants.has(p.vehicle_ref)) occupants.get(p.vehicle_ref).push(out);
    else unplaced.push(out); // a driver or passenger whose vehicle isn't in the vehicle table
  }
  // Drivers first, then passengers.
  for (const list of occupants.values()) list.sort((a, b) => (a.role === "driver" ? -1 : 0) - (b.role === "driver" ? -1 : 0));

  return {
    collisionId: crash.collision_id,
    recognize: {
      date: crash.crash_date,
      time: timeLabel(crash.crash_minute),
      location: locationLine(crash),
      onStreet: street(crash.on_street),
      crossStreet: street(crash.cross_street),
      offStreet: street(crash.off_street),
      borough: boroughLabel(crash.borough),
      zip: crash.zip_code,
      area: areaLine(crash),
      point: crash.latitude != null ? { lat: crash.latitude, lon: crash.longitude } : null
    },
    details: {
      injured: crash.persons_injured, killed: crash.persons_killed,
      pedestriansInjured: crash.pedestrians_injured, pedestriansKilled: crash.pedestrians_killed,
      cyclistsInjured: crash.cyclists_injured, cyclistsKilled: crash.cyclists_killed,
      motoristsInjured: crash.motorists_injured, motoristsKilled: crash.motorists_killed,
      factors: parse(crash.factors),
      vehicleCodes: parse(crash.vehicle_codes)
    },
    vehicles: vehicles.map((v, i) => ({
      ref: v.unique_id,
      number: i + 1,
      label: vehicleSummary(v),
      recognize: {
        type: vehicleTypeName(v),
        make: makeName(v),
        makeAsRecorded: v.make_raw,
        year: v.vehicle_year,
        state: v.state_registration,
        direction: v.travel_direction,
        occupants: v.occupants,
        driverSex: v.driver_sex === "M" ? "Male" : v.driver_sex === "F" ? "Female" : null,
        licenseStatus: v.license_status,
        licenseJurisdiction: v.license_jurisdiction
      },
      details: {
        preCrash: v.pre_crash,
        pointOfImpact: v.point_of_impact,
        damage: parse(v.damage),
        publicPropertyDamage: v.public_property_damage,
        publicPropertyDamageType: v.public_property_damage_type,
        factors: parse(v.factors)
      },
      people: occupants.get(v.unique_id)
    })),
    outside,
    unplaced,
    notInvolved,
    sources: Object.keys(DATASETS).map((t) => ({ name: DATASETS[t].name, url: sourceUrl(t), id: DATASETS[t].id }))
  };
}
