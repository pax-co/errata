import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const DOCS_DIR = 'docs/_fork_features'
const DEFAULT_RANGE = 'upstream/master..fork-features'
const FEATURE_TRAILER = 'Fork-Feature'
const MAINTENANCE_SUBJECT = /^(?:chore|docs)\(fork\):\s/
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function git(args: string[], input?: string): string {
  const result = spawnSync('git', args, {
    encoding: 'utf8',
    input,
  })

  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim()
    throw new Error(`git ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`)
  }

  return result.stdout.trim()
}

function loadFeatureDocs(): Set<string> {
  const readme = readFileSync(join(DOCS_DIR, 'README.md'), 'utf8')
  const indexStart = readme.indexOf('| Feature |')
  const indexEnd = indexStart === -1 ? -1 : readme.indexOf('\n## ', indexStart)
  if (indexStart === -1 || indexEnd === -1) throw new Error(`${DOCS_DIR}/README.md has no feature index`)

  const indexedSlugs = [...readme.slice(indexStart, indexEnd)
    .matchAll(/\]\(\.\/([a-z0-9]+(?:-[a-z0-9]+)*)\.md\)/g)]
    .map(match => match[1])
  if (new Set(indexedSlugs).size !== indexedSlugs.length) {
    throw new Error(`${DOCS_DIR}/README.md lists a feature more than once`)
  }

  const slugs = new Set<string>()
  const dependencies = new Map<string, string[]>()

  for (const name of readdirSync(DOCS_DIR)) {
    if (name === 'README.md' || !name.endsWith('.md')) continue

    const content = readFileSync(join(DOCS_DIR, name), 'utf8')
    const trailer = content.match(/^\*\*Commit trailer:\*\* `Fork-Feature: ([^`]+)`$/m)
    if (!trailer) throw new Error(`${DOCS_DIR}/${name} has no Commit trailer field`)

    const slug = trailer[1]
    if (!SLUG.test(slug)) throw new Error(`${DOCS_DIR}/${name} has invalid slug '${slug}'`)
    if (`${slug}.md` !== name) throw new Error(`${DOCS_DIR}/${name} declares slug '${slug}'`)
    if (slugs.has(slug)) throw new Error(`duplicate feature slug '${slug}'`)
    slugs.add(slug)

    const dependencyField = content.match(/^\*\*Dependencies:\*\* (.+)$/m)
    if (!dependencyField) throw new Error(`${DOCS_DIR}/${name} has no Dependencies field`)
    if (dependencyField[1] === 'none') {
      dependencies.set(slug, [])
    } else {
      const values = [...dependencyField[1].matchAll(/`([^`]+)`/g)].map(match => match[1])
      if (values.length === 0) throw new Error(`${DOCS_DIR}/${name} has an invalid Dependencies field`)
      dependencies.set(slug, values)
    }
  }

  const indexed = new Set(indexedSlugs)
  for (const slug of slugs) {
    if (!indexed.has(slug)) throw new Error(`feature '${slug}' is missing from ${DOCS_DIR}/README.md`)
  }
  for (const slug of indexed) {
    if (!slugs.has(slug)) throw new Error(`${DOCS_DIR}/README.md lists unknown feature '${slug}'`)
  }

  for (const [slug, values] of dependencies) {
    for (const dependency of values) {
      if (dependency === slug) throw new Error(`feature '${slug}' depends on itself`)
      if (!slugs.has(dependency)) throw new Error(`feature '${slug}' has unknown dependency '${dependency}'`)
    }
  }

  const visited = new Set<string>()
  const visiting = new Set<string>()
  const path: string[] = []

  function visit(slug: string): void {
    if (visited.has(slug)) return
    if (visiting.has(slug)) {
      const cycleStart = path.indexOf(slug)
      const cycle = [...path.slice(cycleStart), slug].join(' -> ')
      throw new Error(`feature dependency cycle: ${cycle}`)
    }

    visiting.add(slug)
    path.push(slug)
    for (const dependency of dependencies.get(slug) ?? []) visit(dependency)
    path.pop()
    visiting.delete(slug)
    visited.add(slug)
  }

  for (const slug of slugs) visit(slug)

  return slugs
}

function featureTrailers(message: string): string[] {
  const parsed = git(['interpret-trailers', '--parse'], message)
  if (!parsed) return []

  return parsed
    .split('\n')
    .map(line => line.match(/^Fork-Feature:\s*(.+)$/))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map(match => match[1].trim())
}

function main(): void {
  const range = process.argv[2] ?? DEFAULT_RANGE
  const slugs = loadFeatureDocs()
  const rows = git(['rev-list', '--reverse', '--topo-order', '--parents', range])
  const errors: string[] = []
  let featureCount = 0
  let maintenanceCount = 0
  let mergeCount = 0

  for (const row of rows ? rows.split('\n') : []) {
    const [hash, ...parents] = row.split(' ')
    const message = git(['show', '-s', '--format=%B', hash])
    const subject = message.split('\n', 1)[0]
    const trailers = featureTrailers(message)
    const shortHash = hash.slice(0, 7)

    if (parents.length > 1) {
      mergeCount += 1
      if (trailers.length > 0) errors.push(`${shortHash} merge commit has a ${FEATURE_TRAILER} trailer`)
      continue
    }

    if (MAINTENANCE_SUBJECT.test(subject)) {
      maintenanceCount += 1
      if (trailers.length > 0) errors.push(`${shortHash} maintenance commit has a ${FEATURE_TRAILER} trailer`)
      continue
    }

    if (trailers.length !== 1) {
      errors.push(`${shortHash} ${JSON.stringify(subject)} has ${trailers.length} ${FEATURE_TRAILER} trailers; expected 1`)
      continue
    }

    featureCount += 1
    const slug = trailers[0]
    if (!slugs.has(slug)) {
      errors.push(`${shortHash} uses unknown feature slug '${slug}'`)
    }
  }

  if (errors.length > 0) {
    console.error(`Fork feature validation failed for ${range}:`)
    for (const error of errors) console.error(`- ${error}`)
    process.exit(1)
  }

  console.log(
    `Validated ${range}: ${featureCount} trailer-owned, ${maintenanceCount} maintenance, `
      + `${mergeCount} merge commits; ${slugs.size} feature slugs.`,
  )
}

main()
