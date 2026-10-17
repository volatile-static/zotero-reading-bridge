/**
 * Every live case in execution order. Order matters: seeding precedes everything that reads fixtures,
 * the read-only proof runs after all other tool traffic, and the lifecycle cases (add-on toggle, pane) run last.
 */
import { contextCases } from "./context.js";
import { downloadCases } from "./downloads.js";
import { harnessCases } from "./harness.js";
import { lifecycleCases } from "./lifecycle.js";
import { protocolCases } from "./protocol.js";
import { toolCases } from "./tools.js";
import type { TestCase } from "./types.js";
import { uiCases } from "./ui.js";

export const allCases: TestCase[] = [...harnessCases, ...uiCases, ...protocolCases, ...toolCases, ...contextCases, ...downloadCases, ...lifecycleCases];

const duplicate = allCases.map((c) => c.id).find((id, i, ids) => ids.indexOf(id) !== i);
if (duplicate) throw new Error(`Duplicate case id ${duplicate}`);
