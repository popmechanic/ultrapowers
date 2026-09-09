// fleet/janitor.mjs — a stand-in for the reaper.
export const reap = (vms) => vms.filter((vm) => vm.idle)
export default { reap }
