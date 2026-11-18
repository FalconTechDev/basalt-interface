// Shared lazy access to application-scope values.
//
// Some own modules need names that live in the application scope of the bundle (platform info, the lazy `require`
// shim, markdown parser entry points, yaml helpers, ...). The manifest's `envBind` installs a thunk here once,
// and every use reads it lazily so late-bound bundle variables stay correct.
let thunk = () => ({});

/** Installs the thunk that resolves host values; called once by the generated bundle. */
export function bindEnv(t) { thunk = t; }

/** The current host environment object. */
export function env() { return thunk(); }
/** The late-bound host values for any own module (alias used by the settings and sync modules). */
export const hostEnv = env;
