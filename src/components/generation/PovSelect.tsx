import { useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, type Fragment } from '@/lib/api'
import { readPovCharacterId, writePovCharacterId } from '@/lib/api/generation'
import { cn } from '@/lib/utils'

interface PovSelectProps {
  storyId: string
  disabled?: boolean
}

/** Narrator first, then non-archived characters filtered by a case-insensitive substring. */
function filterOptions(characters: Fragment[] | undefined, query: string): Array<Pick<Fragment, 'id' | 'name'>> {
  const q = query.trim().toLowerCase()
  return [
    ...(!q || 'narrator'.startsWith(q) ? [{ id: '', name: 'Narrator' }] : []),
    ...(characters ?? [])
      .filter((c) => !c.archived)
      .filter((c) => !q || c.name.toLowerCase().startsWith(q)),
  ]
}

/** Compact POV character picker with type-to-filter, persisted per story in localStorage. */
export function PovSelect({ storyId, disabled }: PovSelectProps) {
  const [value, setValue] = useState<string>(() => readPovCharacterId(storyId) ?? '')
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const { data: characters } = useQuery({
    queryKey: ['fragments', storyId, 'character'],
    queryFn: () => api.fragments.list(storyId, 'character'),
    staleTime: 30_000,
  })

  const options = filterOptions(characters, query)
  const activeIndex = Math.min(highlight, options.length - 1)
  const selectedName = (characters ?? []).find((c) => c.id === value)?.name

  function openList() {
    setOpen(true)
    setQuery('')
    setHighlight(Math.max(0, filterOptions(characters, '').findIndex((o) => o.id === value)))
  }

  function close() {
    setOpen(false)
    setQuery('')
    inputRef.current?.blur()
  }

  function commit(id: string) {
    setValue(id)
    writePovCharacterId(storyId, id || undefined)
    close()
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      e.preventDefault()
      openList()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight(Math.min(activeIndex + 1, options.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight(Math.max(activeIndex - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      commit(options[activeIndex]?.id ?? '')
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }

  return (
    <div className="relative inline-block" data-component-id="pov-select">
      <input
        ref={inputRef}
        role="combobox"
        aria-expanded={open}
        aria-controls="pov-select-options"
        aria-label="Point-of-view character"
        value={open ? query : selectedName ?? 'Narrator'}
        placeholder="Type to filter…"
        disabled={disabled}
        onFocus={openList}
        onChange={(e) => { setQuery(e.target.value); setHighlight(0) }}
        onKeyDown={onKeyDown}
        onBlur={() => { if (open) close() }}
        title="Point-of-view character whose voice drives this passage"
        className="text-[0.625rem] text-foreground/60 bg-muted/50 hover:bg-muted/70 border border-border/40 hover:border-border/60 rounded-md outline-none cursor-pointer transition-all duration-200 appearance-none pl-2 pr-5 py-1 font-mono w-[140px] truncate disabled:opacity-30 disabled:cursor-default focus:ring-1 focus:ring-primary/20 focus:border-primary/30 focus:bg-muted/70 focus:text-foreground"
        style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.5' stroke-linecap='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 6px center' }}
      />
      {open && (
        <ul
          id="pov-select-options"
          role="listbox"
          className="bg-popover text-popover-foreground animate-in fade-in-0 zoom-in-95 absolute bottom-full left-0 z-50 mb-1 max-h-[220px] w-full overflow-y-auto rounded-md border p-1 shadow-md"
        >
          {options.map((option, i) => (
            <li
              key={option.id || 'narrator'}
              role="option"
              aria-selected={option.id === value}
              title={option.name}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => commit(option.id)}
              className={cn(
                'truncate rounded-sm px-2 py-1 font-mono text-xs cursor-pointer',
                i === activeIndex ? 'bg-muted text-foreground' : 'text-muted-foreground',
                option.id === value && 'font-medium',
              )}
            >
              {option.name}
            </li>
          ))}
          {options.length === 0 && (
            <li className="px-2 py-1 font-mono text-xs text-muted-foreground italic">No matching character</li>
          )}
        </ul>
      )}
    </div>
  )
}
