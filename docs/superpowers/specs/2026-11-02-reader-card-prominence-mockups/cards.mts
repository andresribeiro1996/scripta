import { writeFileSync } from "node:fs";
import { renderPlate } from "../../../../packages/shared/src/readerCards/render.ts";
const people = [["star","paper","Marta Lopes"],["lamp","reversed","Rui Matos"],["carto","paper","Inês Costa"],["way","reversed","João Pinto"]] as const;
const out = people.map(([id, print, name]) => ({ id, print, name, svg: renderPlate({ identity: id, state: "settled", readerName: name, print, label: "card", locale: "pt-PT", width: 140 }) }));
writeFileSync(process.argv[2], JSON.stringify(out));
