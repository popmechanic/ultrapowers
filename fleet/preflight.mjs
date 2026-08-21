/**
 * Preflight probe — test the one unproven transport link (SSH→HTTPS fallback).
 * Attempts VM-to-VM git fetch over SSH, falling back to HTTPS ls-remote if that fails.
 */

export async function preflight({ orchVm, probeVm, exec }) {
  const sshCmd = `ssh ${orchVm}.exe.xyz 'git -C /home/exedev/repo fetch ssh://exedev@${probeVm}.exe.xyz/home/exedev/repo'`
  const httpsCmd = `ssh ${orchVm}.exe.xyz 'git ls-remote https://${probeVm}.exe.xyz/repo.git'`

  // Attempt SSH fetch first
  const sshResult = await exec(sshCmd)
  const sshFetch = sshResult.code === 0

  // If SSH fails, try HTTPS fallback
  let httpsFallback = false
  if (!sshFetch) {
    const httpsResult = await exec(httpsCmd)
    httpsFallback = httpsResult.code === 0
  }

  // Map results to verdict
  let verdict
  if (sshFetch) {
    verdict = 'ssh'
  } else if (httpsFallback) {
    verdict = 'https-fallback'
  } else {
    verdict = 'BLOCKED'
  }

  return { sshFetch, httpsFallback, verdict }
}
