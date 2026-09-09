// fleet/retire.mjs — a stand-in for the retirement pass.
export const retire = (vm) => ({ ...vm, retired: true })
export default { retire }
