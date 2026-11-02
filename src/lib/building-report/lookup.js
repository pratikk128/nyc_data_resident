/*
 * A typed address → the building it names, with NYC GeoSearch. A building
 * report needs a street address with a house number: GeoSearch's match
 * carries its tax lot (BBL) and building (BIN). Matching follows the 311
 * dashboard's rules (complaints311/geocode.js chooseMatch()): the house
 * number and street must agree with what was typed, and an address that's in
 * two boroughs asks which. Takes a search function so tests pass canned results.
 */
import { chooseMatch, geosearch } from "../complaints311/geocode.js";
import { boroughLabel } from "../complaints311/config.js";
import { isBbl, buildingPath } from "./config.js";

const withBbl = (places) => places.filter((p) => isBbl(p.bbl));

/*
 * parsed: parseLocationInput()'s answer.
 * → { status: "resolved", place }                 place.bbl is set
 *   { status: "choose", reason, suggestions }     only places with a BBL
 *   { status: "not-found" }
 *   { status: "need-address", text }              a ZIP, borough or street alone
 */
export async function findBuilding(parsed, { search = (text, size) => geosearch("search", text, { size }) } = {}) {
  if (parsed.kind === "empty") return { status: "need-address", text: "Type a street address: house number, street and borough." };
  if (parsed.kind === "error") return { status: "need-address", text: parsed.message };
  if (parsed.kind !== "address") {
    return { status: "need-address", text: "Add the house number: a report is for one building, so include the number, street and borough." };
  }
  const where = [parsed.borough && boroughLabel(parsed.borough), parsed.zip].filter(Boolean).join(" ");
  const text = `${parsed.houseNumber} ${parsed.text.replace(/^\S+\s+/, "")}`;
  const places = withBbl(await search(where ? `${text}, ${where}` : text, 10));
  const match = chooseMatch(parsed, places);
  if (match.status === "resolved") return { status: "resolved", place: match.place };
  return match;
}

export const placePath = (place) => buildingPath(place.bbl);
