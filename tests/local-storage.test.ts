// Runs the shared suites against local storage: SQLite + files on disk (DATA_DIR from tests/setup.ts).
import { assistanceSuite } from "./suites/assistance";
import { cameraSuite } from "./suites/camera";
import { lifecycleSuite } from "./suites/lifecycle";

lifecycleSuite();
cameraSuite();
assistanceSuite();
