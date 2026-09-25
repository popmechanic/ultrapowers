// A reader of file text as it stood at the run's BASE, for the pair builder.
// `factory/pairs.mjs` takes all file text through a caller-supplied
// `read(path)` that answers '' for a missing file; this is that reader.
// `git(args, cwd)` throws on a non-zero exit — a path absent at `base` —
// and that reads as empty.

// With no `base` given, the reader falls back to the target's own `HEAD`.

export function baseReader({ git, target, base }) {
  const rev = base ? String(base) : 'HEAD'
  return async (path) => {
    try {
      return String(await git(['show', rev + ':' + path], target))
    } catch {
      return ''
    }
  }
}
